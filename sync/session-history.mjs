// Durable local session history.
//
// sessions.jsonl is an uncapped append-only revision log. current.json is a
// derived full-history index for fast local queries; it is rebuilt atomically
// and never used as the retention boundary.

import {
  chmodSync, closeSync, existsSync, fstatSync, ftruncateSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readSync, renameSync, realpathSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const FORBIDDEN_KEYS = new Set(['cwd', 'raw_ref', 'session_title', 'first_user_message']);
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const DEFAULT_WARNING_THRESHOLD = 100_000;
const INDEX_SCHEMA_VERSION = 2;
const MAX_RECOVERY_TAIL_BYTES = 64 * 1024 * 1024;

function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeDurable(path, content, flag = 'w') {
  const fd = openSync(path, flag, 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}

function sessionIdentity(session) {
  return JSON.stringify([session.source || 'claude', session.session_id]);
}

export function assertHistoryOutsideWorktree(dir) {
  let current = resolve(dir);
  const missingParts = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missingParts.unshift(basename(current));
    current = parent;
  }
  current = resolve(realpathSync(current), ...missingParts);
  while (true) {
    if (existsSync(join(current, '.git'))) {
      throw new Error(`[worktree-guard] session history ${dir} is inside a git worktree (${current}) — refusing`);
    }
    const parent = dirname(current);
    if (parent === current) return dir;
    current = parent;
  }
}

export function resolveSessionHistoryDir(dir = process.env.MEOW_SESSION_HISTORY_DIR) {
  const resolved = resolve(dir || join(homedir(), '.meow-ops', 'session-history'));
  assertHistoryOutsideWorktree(resolved);
  return resolved;
}

function sanitizeValue(value, path = '') {
  if (Array.isArray(value)) return value.map((item, index) => sanitizeValue(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`[forbidden-key] session history rejected content-bearing field at ${path ? `${path}.` : ''}${key}`);
    }
    out[key] = sanitizeValue(child, path ? `${path}.${key}` : key);
  }
  return out;
}

function readIndex(dir) {
  const file = join(dir, 'current.json');
  let index;
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed?.sessions)
        && Number.isInteger(parsed.logBytes) && parsed.logBytes >= 0) {
        index = {
          ...parsed,
          sessions: parsed.sessions.map((session) => sanitizeValue(session)),
        };
      }
    } catch { /* recover from the append-only log below */ }
  }
  if (!index) return readLogIndex(dir);

  const logFile = join(dir, 'sessions.jsonl');
  const actualBytes = existsSync(logFile) ? statSync(logFile).size : 0;
  if (actualBytes < index.logBytes) {
    throw new Error('[session-history] append-only log is shorter than its committed index; restore the archive before syncing.');
  }
  // Version 1 keyed sessions by ID alone and could collapse two harnesses that
  // used the same ID. The retained revision log can reconstruct both safely.
  if (index.schemaVersion !== INDEX_SCHEMA_VERSION) return readLogIndex(dir);
  if (actualBytes === index.logBytes) return { ...index, incompleteTailBytes: 0 };
  // A completed append survives a crash before current.json is published.
  // Replay only the unindexed tail; reads never rewrite either archive file.
  return readLogIndex(dir, null, index);
}

function readLogIndex(dir, maxBytes = null, seed = null) {
  const logFile = join(dir, 'sessions.jsonl');
  if (!existsSync(logFile)) {
    if (maxBytes > 0) throw new Error('[session-history] committed snapshot log is missing.');
    return { schemaVersion: INDEX_SCHEMA_VERSION, updatedAt: null, logBytes: 0, incompleteTailBytes: 0, sessions: [] };
  }
  const size = statSync(logFile).size;
  if (maxBytes > size) throw new Error('[session-history] append-only log is shorter than the requested snapshot.');
  const end = Number.isInteger(maxBytes) && maxBytes >= 0 ? maxBytes : size;
  const start = seed?.logBytes || 0;
  const buffer = Buffer.alloc(end - start);
  const fd = openSync(logFile, 'r');
  try {
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, start + offset);
      if (!read) throw new Error('[session-history] append-only log changed during recovery; retry the read.');
      offset += read;
    }
  } finally {
    closeSync(fd);
  }
  // Our writer commits newline-terminated revisions. Leave a torn final append
  // untouched and readable as the last good snapshot; never join new JSON to it.
  const committedBytes = buffer.lastIndexOf(0x0a) + 1;
  const logBytes = start + committedBytes;
  const byId = new Map((seed?.sessions || []).map(session => [sessionIdentity(session), session]));
  let updatedAt = seed?.updatedAt || null;
  for (const line of buffer.subarray(0, committedBytes).toString('utf8').split('\n').filter(Boolean)) {
    let revision;
    try { revision = JSON.parse(line); } catch {
      throw new Error('[session-history] append-only log contains an invalid revision; restore the archive before syncing.');
    }
    if (typeof revision?.session?.session_id !== 'string' || !revision.session.session_id) {
      throw new Error('[session-history] append-only log contains an invalid revision identity.');
    }
    byId.set(sessionIdentity(revision.session), sanitizeValue(revision.session));
    updatedAt = revision.archived_at || updatedAt;
  }
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    updatedAt,
    logBytes,
    incompleteTailBytes: end - logBytes,
    sessions: sortedSessions(byId.values()),
  };
}

function activityTime(session) {
  const value = Date.parse(session.ended_at || session.started_at || '');
  return Number.isFinite(value) ? value : 0;
}

function sortedSessions(sessions) {
  return [...sessions].sort((a, b) => activityTime(b) - activityTime(a)
    || String(a.session_id).localeCompare(String(b.session_id))
    || String(a.source || 'claude').localeCompare(String(b.source || 'claude')));
}

function archiveVersionFor(index, sessions = sortedSessions(index.sessions)) {
  return createHash('sha256').update(String(index.logBytes))
    .update('\0').update(JSON.stringify(sessions)).digest('hex');
}

function warningThreshold(value) {
  const parsed = Number.parseInt(value ?? process.env.MEOW_SESSION_ARCHIVE_WARNING_THRESHOLD ?? DEFAULT_WARNING_THRESHOLD, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WARNING_THRESHOLD;
}

export function updateSessionHistory(sessions, options = {}) {
  const dir = resolveSessionHistoryDir(options.dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const updatedAt = options.updatedAt || new Date().toISOString();
  const recovery = options.recoverIncompleteTail === true ? recoverIncompleteSessionHistory({ dir }) : null;
  const prior = readIndex(dir);
  if (prior.incompleteTailBytes) {
    throw new Error('[session-history] incomplete append detected; preserve and recover the archive tail before syncing.');
  }
  const byId = new Map(prior.sessions.map((session) => [sessionIdentity(session), session]));
  const revisions = [];

  for (const raw of sessions) {
    if (!raw || typeof raw.session_id !== 'string' || !raw.session_id) continue;
    const session = sanitizeValue(raw);
    const identity = sessionIdentity(session);
    const existing = byId.get(identity);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(session)) {
      revisions.push({ archived_at: updatedAt, session });
      byId.set(identity, session);
    }
  }

  const logFile = join(dir, 'sessions.jsonl');
  if (revisions.length > 0) {
    const existed = existsSync(logFile);
    const fd = openSync(logFile, 'a', 0o600);
    try {
      writeFileSync(fd, `${revisions.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
      fsyncSync(fd);
    } finally { closeSync(fd); }
    if (!existed) syncDirectory(dir);
    chmodSync(logFile, 0o600);
  }

  const currentFile = join(dir, 'current.json');
  const tempFile = join(dir, `.current-${process.pid}-${Date.now()}.json`);
  const current = {
    schemaVersion: INDEX_SCHEMA_VERSION,
    updatedAt,
    logBytes: existsSync(logFile) ? statSync(logFile).size : 0,
    sessions: sortedSessions(byId.values()),
  };
  writeDurable(tempFile, JSON.stringify(current), 'wx');
  renameSync(tempFile, currentFile);
  chmodSync(currentFile, 0o600);
  syncDirectory(dir);

  const threshold = warningThreshold(options.warningThreshold);
  return {
    appended: revisions.length,
    total: current.sessions.length,
    warningThreshold: threshold,
    thresholdExceeded: current.sessions.length > threshold,
    recoveredTailBytes: recovery?.bytes || 0,
    dir,
  };
}

/** Preserve a torn tail before removing it from the append position. Source harness logs stay read-only. */
export function recoverIncompleteSessionHistory(options = {}) {
  const dir = resolveSessionHistoryDir(options.dir);
  const prior = readIndex(dir);
  if (!prior.incompleteTailBytes) return { recovered: false, bytes: 0, recoveryFile: null };
  const recoveryLimit = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? Math.min(options.maxBytes, MAX_RECOVERY_TAIL_BYTES) : MAX_RECOVERY_TAIL_BYTES;
  if (prior.incompleteTailBytes > recoveryLimit) {
    throw new Error('[session-history] incomplete tail exceeds the automatic recovery limit; preserve it and inspect the archive manually.');
  }
  const logFile = join(dir, 'sessions.jsonl');
  const before = statSync(logFile);
  if (before.nlink > 1) throw new Error('[session-history] linked archive log cannot be repaired automatically.');
  const bytes = Buffer.alloc(prior.incompleteTailBytes);
  const fd = openSync(logFile, 'r+');
  try {
    const current = fstatSync(fd);
    if (current.ino !== before.ino || current.dev !== before.dev || current.size !== before.size) {
      throw new Error('[session-history] archive changed during tail recovery; retry after sync stops.');
    }
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, prior.logBytes + offset);
      if (!read) throw new Error('[session-history] archive tail changed during recovery.');
      offset += read;
    }
    const recoveryDir = join(dir, 'recovery');
    mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
    const digest = createHash('sha256').update(bytes).digest('hex');
    const recoveryFile = join(recoveryDir, `${digest}.partial`);
    if (existsSync(recoveryFile)) {
      if (!readFileSync(recoveryFile).equals(bytes)) throw new Error('[session-history] recovery digest collision; archive unchanged.');
    } else writeDurable(recoveryFile, bytes, 'wx');
    syncDirectory(recoveryDir);
    const latest = fstatSync(fd);
    if (latest.ino !== before.ino || latest.size !== before.size || latest.mtimeMs !== before.mtimeMs) {
      throw new Error('[session-history] archive changed before recovery; retry after sync stops.');
    }
    ftruncateSync(fd, prior.logBytes);
    fsyncSync(fd);
    syncDirectory(dir);
    return { recovered: true, bytes: bytes.length, recoveryFile };
  } finally { closeSync(fd); }
}

export function readSessionHistory(options = {}) {
  const dir = resolveSessionHistoryDir(options.dir);
  return sortedSessions(readIndex(dir).sessions);
}

export function readSessionHistorySnapshot(options = {}) {
  const index = readIndex(resolveSessionHistoryDir(options.dir));
  return {
    updatedAt: index.updatedAt,
    sessions: index.sessions,
    archiveVersion: archiveVersionFor(index),
    snapshotBytes: index.logBytes,
    incompleteTailBytes: index.incompleteTailBytes || 0,
  };
}

function encodeCursor(session, snapshotBytes) {
  return Buffer.from(JSON.stringify({
    activity: activityTime(session),
    sessionId: String(session.session_id),
    source: String(session.source || 'claude'),
    snapshotBytes,
  }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Number.isFinite(value.activity)
      || typeof value.sessionId !== 'string'
      || !Number.isInteger(value.snapshotBytes)
      || value.snapshotBytes < 0) return null;
    return {
      activity: value.activity,
      sessionId: value.sessionId,
      source: typeof value.source === 'string' ? value.source : null,
      snapshotBytes: value.snapshotBytes,
    };
  } catch {
    return null;
  }
}

function dateBoundary(value, endOfDay = false) {
  if (!value) return null;
  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}${suffix}` : value);
  return Number.isFinite(parsed) ? parsed : null;
}

function activityDay(session) {
  const date = new Date(session.ended_at || session.started_at || '');
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.MEOW_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function querySessionHistory(options = {}) {
  const dir = resolveSessionHistoryDir(options.dir);
  const cursor = decodeCursor(options.cursor);
  if (options.cursor && !cursor) {
    throw Object.assign(new Error('Invalid session cursor; restart from the first page.'), { code: 'invalid_session_cursor' });
  }
  const hasSnapshotBytes = options.snapshotBytes !== undefined && options.snapshotBytes !== null && options.snapshotBytes !== '';
  const snapshotBytes = hasSnapshotBytes ? Number(options.snapshotBytes) : null;
  if (hasSnapshotBytes && (!Number.isSafeInteger(snapshotBytes) || snapshotBytes < 0 || !options.expectedVersion)) {
    throw Object.assign(new Error('A published archive boundary and version are required.'), { code: 'invalid_archive_snapshot' });
  }
  if (cursor && hasSnapshotBytes && cursor.snapshotBytes !== snapshotBytes) {
    throw Object.assign(new Error('The cursor belongs to another archive snapshot.'), { code: 'stale_archive_snapshot' });
  }
  const boundary = cursor?.snapshotBytes ?? snapshotBytes;
  // Damage in an unpublished append must not affect the published prefix.
  const index = boundary === null ? readIndex(dir) : readLogIndex(dir, boundary);
  const all = sortedSessions(index.sessions);
  // The index's updatedAt can advance on a no-change sync. Bind the version to
  // committed contents so current and historical cursor reads agree instead.
  const archiveVersion = archiveVersionFor(index, all);
  if (options.expectedVersion && options.expectedVersion !== archiveVersion) {
    throw Object.assign(new Error('Session archive changed; restart from the first page.'), { code: 'stale_archive_snapshot' });
  }
  const limitValue = Number.parseInt(options.limit ?? DEFAULT_PAGE_SIZE, 10);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(limitValue) ? limitValue : DEFAULT_PAGE_SIZE));
  const from = dateBoundary(options.from);
  const to = dateBoundary(options.to, true);
  const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(options.from || '') ? options.from : null;
  const toDay = /^\d{4}-\d{2}-\d{2}$/.test(options.to || '') ? options.to : null;
  const filtered = all.filter((session) => {
    const activity = activityTime(session);
    const day = fromDay || toDay ? activityDay(session) : null;
    if (fromDay ? day < fromDay : from !== null && activity < from) return false;
    if (toDay ? day > toDay : to !== null && activity > to) return false;
    if (options.project && session.project !== options.project) return false;
    if (options.source && session.source !== options.source) return false;
    if (options.model && session.model !== options.model) return false;
    return true;
  });
  const eligible = cursor ? filtered.filter((session) => {
    const activity = activityTime(session);
    const idOrder = String(session.session_id).localeCompare(cursor.sessionId);
    return activity < cursor.activity
      || (activity === cursor.activity && (idOrder > 0
        || (idOrder === 0 && cursor.source !== null
          && String(session.source || 'claude').localeCompare(cursor.source) > 0)));
  }) : filtered;
  const items = eligible.slice(0, limit);
  const threshold = warningThreshold(options.warningThreshold);
  const unique = (key) => [...new Set(all.map((row) => row[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

  return {
    archiveVersion,
    snapshotBytes: index.logBytes,
    items,
    total: filtered.length,
    limit,
    nextCursor: eligible.length > items.length && items.length > 0
      ? encodeCursor(items[items.length - 1], index.logBytes)
      : null,
    facets: {
      projects: unique('project'),
      sources: unique('source'),
      models: unique('model'),
    },
    archive: {
      total: all.length,
      incompleteTailBytes: index.incompleteTailBytes || 0,
      warningThreshold: threshold,
      thresholdExceeded: all.length > threshold,
    },
  };
}
