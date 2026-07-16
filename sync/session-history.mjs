// Durable local session history.
//
// sessions.jsonl is an uncapped append-only revision log. current.json is a
// derived full-history index for fast local queries; it is rebuilt atomically
// and never used as the retention boundary.

import {
  appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const FORBIDDEN_KEYS = new Set(['cwd', 'session_title', 'first_user_message']);
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const DEFAULT_WARNING_THRESHOLD = 100_000;

export function assertHistoryOutsideWorktree(dir) {
  let current = resolve(dir);
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
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed?.sessions)) return parsed;
    } catch { /* recover from the append-only log below */ }
  }
  const logFile = join(dir, 'sessions.jsonl');
  if (!existsSync(logFile)) return { schemaVersion: 1, updatedAt: null, sessions: [] };
  const byId = new Map();
  let updatedAt = null;
  for (const line of readFileSync(logFile, 'utf8').split('\n').filter(Boolean)) {
    let revision;
    try { revision = JSON.parse(line); } catch {
      throw new Error(`[session-history] append-only log contains an invalid revision: ${logFile}`);
    }
    if (revision?.session?.session_id) {
      byId.set(revision.session.session_id, sanitizeValue(revision.session));
      updatedAt = revision.archived_at || updatedAt;
    }
  }
  return { schemaVersion: 1, updatedAt, sessions: sortedSessions(byId.values()) };
}

function activityTime(session) {
  const value = Date.parse(session.ended_at || session.started_at || '');
  return Number.isFinite(value) ? value : 0;
}

function sortedSessions(sessions) {
  return [...sessions].sort((a, b) => activityTime(b) - activityTime(a)
    || String(a.session_id).localeCompare(String(b.session_id)));
}

function warningThreshold(value) {
  const parsed = Number.parseInt(value ?? process.env.MEOW_SESSION_ARCHIVE_WARNING_THRESHOLD ?? DEFAULT_WARNING_THRESHOLD, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WARNING_THRESHOLD;
}

export function updateSessionHistory(sessions, options = {}) {
  const dir = resolveSessionHistoryDir(options.dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const updatedAt = options.updatedAt || new Date().toISOString();
  const prior = readIndex(dir);
  const byId = new Map(prior.sessions.map((session) => [session.session_id, session]));
  const revisions = [];

  for (const raw of sessions) {
    if (!raw || typeof raw.session_id !== 'string' || !raw.session_id) continue;
    const session = sanitizeValue(raw);
    const existing = byId.get(session.session_id);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(session)) {
      revisions.push({ archived_at: updatedAt, session });
      byId.set(session.session_id, session);
    }
  }

  const logFile = join(dir, 'sessions.jsonl');
  if (revisions.length > 0) {
    appendFileSync(logFile, `${revisions.map((row) => JSON.stringify(row)).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    chmodSync(logFile, 0o600);
  }

  const currentFile = join(dir, 'current.json');
  const tempFile = join(dir, `.current-${process.pid}-${Date.now()}.json`);
  const current = {
    schemaVersion: 1,
    updatedAt,
    sessions: sortedSessions(byId.values()),
  };
  writeFileSync(tempFile, JSON.stringify(current), { encoding: 'utf8', mode: 0o600 });
  renameSync(tempFile, currentFile);
  chmodSync(currentFile, 0o600);

  const threshold = warningThreshold(options.warningThreshold);
  return {
    appended: revisions.length,
    total: current.sessions.length,
    warningThreshold: threshold,
    thresholdExceeded: current.sessions.length > threshold,
    dir,
  };
}

export function readSessionHistory(options = {}) {
  const dir = resolveSessionHistoryDir(options.dir);
  return sortedSessions(readIndex(dir).sessions);
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Number.isInteger(value.offset) && value.offset >= 0 ? value.offset : 0;
  } catch {
    return 0;
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
  const all = readSessionHistory(options);
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
  const offset = Math.min(decodeCursor(options.cursor), filtered.length);
  const items = filtered.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  const threshold = warningThreshold(options.warningThreshold);
  const unique = (key) => [...new Set(all.map((row) => row[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

  return {
    items,
    total: filtered.length,
    limit,
    nextCursor: nextOffset < filtered.length ? encodeCursor(nextOffset) : null,
    facets: {
      projects: unique('project'),
      sources: unique('source'),
      models: unique('model'),
    },
    archive: {
      total: all.length,
      warningThreshold: threshold,
      thresholdExceeded: all.length > threshold,
    },
  };
}
