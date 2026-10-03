// Private, metadata-only Cursor billing history. The caller holds the sync lock.
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const MAX_BYTES = 64 * 1024 * 1024;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 256) : null;
const number = value => !['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value)) ? null : Number(value);
const bool = value => typeof value === 'boolean' ? value : null;

export function normalizeCursorUsageEvent(event) {
  const attr = event?.attributes && !Array.isArray(event.attributes) ? event.attributes : {};
  const field = name => event?.[name] ?? attr[name];
  const conversationId = text(event?.conversationId ?? event?.conversation_id ?? event?.coversation_id ?? field('cursor.conversation.id'));
  const product = text(field('cursor.surface'));
  const timestamp = number(event?.timestamp) ?? (Number.isFinite(Date.parse(event?.timestamp)) ? Date.parse(event.timestamp) : null);
  const result = {
    timestamp,
    conversationId,
    cloudAgentId: text(event?.cloudAgentId ?? event?.cloud_agent_id),
    model: text(event?.model),
    requestedModel: text(event?.requestedModel),
    servingModel: text(event?.servingModel),
    product: ['grok_bot', 'desktop', 'cli', 'cloud_agent', 'bugbot'].includes(product) ? product : null,
    botId: product === 'grok_bot' ? conversationId : null,
    kind: text(event?.kind),
    maxMode: bool(event?.maxMode),
    isChargeable: bool(event?.isChargeable),
    isHeadless: bool(event?.isHeadless),
    isTokenBasedCall: bool(event?.isTokenBasedCall),
    chargedCents: number(event?.chargedCents),
    cursorTokenFee: number(event?.cursorTokenFee),
    requestsCosts: number(event?.requestsCosts),
    tokenUsage: Object.fromEntries(['inputTokens', 'outputTokens', 'cacheWriteTokens', 'cacheReadTokens', 'totalCents'].map(key => [key, number(event?.tokenUsage?.[key])])),
  };
  // Hash the account dimension for deduplication; never retain email/name.
  const userValue = event?.userId ?? event?.userEmail ?? event?.user;
  const user = typeof userValue === 'number' && Number.isFinite(userValue) ? String(userValue) : text(userValue);
  const nativeId = text(event?.eventId ?? event?.id ?? field('cursor.usage_event.id') ?? field('cursor.event.id'));
  return {
    ...result,
    identity: nativeId ? `native:${hash(nativeId)}` : `fingerprint:${hash([user, result])}`,
    identityQuality: nativeId ? 'provider-id' : 'exact-record-fingerprint',
  };
}

export function deduplicateCursorUsageEvents(events, { normalized = false } = {}) {
  const rows = new Map();
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    const row = normalizeCursorUsageEvent(normalized ? { ...event, 'cursor.surface': event.product } : event);
    if (normalized && /^(native|fingerprint):[a-f0-9]{64}$/.test(event.identity)) {
      row.identity = event.identity;
      row.identityQuality = event.identity.startsWith('native:') ? 'provider-id' : 'exact-record-fingerprint';
    }
    rows.set(row.identity, row);
  }
  return [...rows.values()];
}

export const emptyCursorUsageHistory = () => ({ schemaVersion: 1, events: [], periods: [], lastAttemptAt: null, lastSuccessAt: null, lastStatus: null });

function safePath(path, create) {
  const file = resolve(path);
  let current = dirname(file);
  const pending = [];
  while (true) {
    let stat;
    try { stat = lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Cursor history refuses symlink or non-directory locations');
      break;
    }
    pending.push(current);
    const parent = dirname(current);
    if (parent === current) throw new Error('Cursor history location unavailable');
    current = parent;
  }
  // Check both lexical and resolved ancestors; refuse data inside any checkout.
  for (const root of [dirname(file), realpathSync(current)]) {
    for (let dir = root; ; dir = dirname(dir)) {
      try { lstatSync(join(dir, '.git')); throw new Error('Cursor history must be outside Git worktrees'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (dirname(dir) === dir) break;
    }
  }
  if (create) {
    for (const dir of pending.reverse()) mkdirSync(dir, { mode: 0o700 });
    chmodSync(dirname(file), 0o700);
  }
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Cursor history requires a private regular file');
    if (stat.size > MAX_BYTES) throw new Error('Cursor history exceeds safe read size');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return file;
}

export function readCursorUsageHistory(path) {
  const file = safePath(path, false);
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return emptyCursorUsageHistory(); throw new Error('Cursor history is unreadable; preserved for recovery', { cause: error }); }
  if (state?.schemaVersion !== 1 || !Array.isArray(state.events) || !Array.isArray(state.periods)
    || state.events.some(event => !event || !/^(native|fingerprint):[a-f0-9]{64}$/.test(event.identity))
    || state.periods.some(period => !Number.isFinite(period.startDate) || !Number.isFinite(period.endDate) || period.endDate < period.startDate)) {
    throw new Error('Cursor history is invalid; preserved for recovery');
  }
  return { schemaVersion: 1, events: deduplicateCursorUsageEvents(state.events, { normalized: true }), periods: state.periods.map(({ startDate, endDate }) => ({ startDate, endDate })), lastAttemptAt: number(state.lastAttemptAt), lastSuccessAt: number(state.lastSuccessAt), lastStatus: text(state.lastStatus) };
}

export function writeCursorUsageHistory(path, state) {
  const file = safePath(path, true);
  const body = JSON.stringify(state);
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Cursor history exceeds safe write size');
  const temp = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, body);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temp, file);
    const dirFd = openSync(dirname(file), 'r');
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch { /* Preserve the original failure; a private temporary file is safe to recover. */ }
  }
}

export function mergeCursorUsageHistory(state, events, period, now) {
  // A complete response replaces only its measured interval. Shorter queries
  // leave older verified intervals intact. Never do this on a partial response.
  const retained = state.events.filter(event => event.timestamp == null || event.timestamp < period.startDate || event.timestamp > period.endDate);
  const periods = [...state.periods, period].sort((a, b) => a.startDate - b.startDate);
  const merged = [];
  for (const item of periods) {
    const last = merged.at(-1);
    if (last && item.startDate <= last.endDate + 1) last.endDate = Math.max(last.endDate, item.endDate);
    else merged.push({ ...item });
  }
  return { ...state, events: deduplicateCursorUsageEvents([...retained, ...deduplicateCursorUsageEvents(events)], { normalized: true }), periods: merged, lastAttemptAt: now, lastSuccessAt: now, lastStatus: 'ok' };
}
