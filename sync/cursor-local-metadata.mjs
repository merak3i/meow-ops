// Read historical request metadata, never Cursor's current model selection.
// User-bubble modelInfo identifies the requested model, not a verified response
// model or a billable call. Zero local token counters do not prove free usage.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

let DatabaseSync;
try {
  ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite'));
} catch {
  // Older Node releases can use the existing sqlite3 CLI dependency.
}

export const DEFAULT_CURSOR_DB = process.platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  : process.platform === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage', 'state.vscdb')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Cursor', 'User', 'globalStorage', 'state.vscdb');

const ID = /^[a-zA-Z0-9_-]{1,150}$/;
const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,100}$/;
const UNRESOLVED = new Set(['default', 'auto', 'unknown']);

function iso(value) {
  if (value == null || value === '') return null;
  const timestamp = typeof value === 'number' && value < 1e12 ? value * 1000 : value;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function queryJson(dbPath, sql) {
  if (DatabaseSync) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try { return db.prepare(sql).all(); } finally { db.close(); }
  }
  const output = execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return output ? JSON.parse(output) : [];
}

function batches(rows, size = 100) {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
}

export function summarizeCursorMetadata(sessions, records = [], requests = []) {
  const local = new Map(sessions.filter(s => s.source === 'cursor').map(s => [s.composer_id, s]));
  const dates = new Map();
  for (const record of records) {
    if (!local.has(record.composer_id)) continue;
    const times = (Array.isArray(record.headers) ? record.headers : [])
      .map(header => iso(header.createdAt)).filter(Boolean).sort();
    if (times.length) dates.set(record.composer_id, { start: times[0], end: times.at(-1) });
  }
  const perSession = new Map();
  const seen = new Set();
  const byModel = new Map();
  let unresolved = 0;
  for (const row of requests) {
    if (!local.has(row.composer_id) || row.type !== 1 || row.simulated || !ID.test(row.bubble_id || '')) continue;
    const key = `${row.composer_id}:${row.bubble_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const model = typeof row.model_name === 'string' && MODEL.test(row.model_name) ? row.model_name : null;
    if (!model || UNRESOLVED.has(model.toLowerCase())) { unresolved++; continue; }
    const sessionModels = perSession.get(row.composer_id) || new Map();
    sessionModels.set(model, (sessionModels.get(model) || 0) + 1);
    perSession.set(row.composer_id, sessionModels);
    const aggregate = byModel.get(model) || { model, requests: 0, sessions: new Set() };
    aggregate.requests++;
    aggregate.sessions.add(row.composer_id);
    byModel.set(model, aggregate);
  }
  return {
    sessions: sessions.map(session => {
      if (session.source !== 'cursor') return session;
      const timing = dates.get(session.composer_id);
      const models = perSession.get(session.composer_id);
      return {
        ...session,
        ...(timing ? {
          started_at: timing.start, ended_at: timing.end,
          duration_seconds: Math.max(0, Math.floor((Date.parse(timing.end) - Date.parse(timing.start)) / 1000)),
          timestamp_source: 'cursor-message-metadata',
        } : {}),
        cursor_requested_models: models ? [...models].map(([model, count]) => ({ model, requests: count })) : [],
      };
    }),
    report: {
      status: 'ok', source: 'cursor-local-request-metadata', range: 'all locally matched transcript history',
      matched_sessions: new Set(records.filter(row => local.has(row.composer_id)).map(row => row.composer_id)).size,
      timestamped_sessions: dates.size,
      requests_with_model: [...byModel.values()].reduce((sum, row) => sum + row.requests, 0),
      unresolved_requests: unresolved,
      by_model: [...byModel.values()].map(row => ({ ...row, sessions: row.sessions.size })).sort((a, b) => b.requests - a.requests),
      limitation: 'Historical requested models, not confirmed response models or billed API calls. Local token counters and costs are not used. Auto/default requests remain unresolved.',
    },
  };
}

export function readCursorLocalMetadata(sessions, { dbPath = process.env.CURSOR_STATE_DB || DEFAULT_CURSOR_DB, query = queryJson } = {}) {
  const fallback = status => ({ sessions, report: { status, matched_sessions: 0, by_model: [], limitation: 'Local Cursor request metadata is unavailable; transcript evidence is retained.' } });
  if (!existsSync(dbPath)) return fallback('not-found');
  const ids = [...new Set(sessions.filter(s => s.source === 'cursor' && ID.test(s.composer_id || '')).map(s => s.composer_id))];
  if (!ids.length) return fallback('no-transcripts');
  try {
    const records = [];
    for (const batch of batches(ids)) {
      const values = batch.map(id => `('${id}')`).join(',');
      const rows = query(dbPath, `WITH wanted(id) AS (VALUES ${values})
        SELECT wanted.id AS composer_id,
          (SELECT json_group_array(json_object(
            'bubbleId', json_extract(h.value,'$.bubbleId'),
            'type', json_extract(h.value,'$.type'),
            'createdAt', json_extract(h.value,'$.createdAt')))
           FROM json_each(CASE WHEN json_valid(d.value) THEN d.value ELSE '{}' END, '$.fullConversationHeadersOnly') h) AS headers
        FROM wanted JOIN cursorDiskKV d ON d.key = 'composerData:' || wanted.id`);
      records.push(...rows.map(row => ({ composer_id: row.composer_id, headers: JSON.parse(row.headers || '[]') })));
    }
    const keys = records.flatMap(record => (Array.isArray(record.headers) ? record.headers : [])
      .filter(header => header.type === 1 && ID.test(header.bubbleId || ''))
      .map(header => ({ composer: record.composer_id, bubble: header.bubbleId })));
    const requests = [];
    for (const batch of batches(keys)) {
      const values = batch.map(row => `('${row.composer}','${row.bubble}')`).join(',');
      requests.push(...query(dbPath, `WITH wanted(composer,bubble) AS (VALUES ${values}),
        data AS (SELECT wanted.*, CASE WHEN json_valid(d.value) THEN d.value ELSE '{}' END AS body
          FROM wanted JOIN cursorDiskKV d ON d.key = 'bubbleId:' || wanted.composer || ':' || wanted.bubble)
        SELECT composer AS composer_id, bubble AS bubble_id,
          json_extract(body,'$.type') AS type, json_extract(body,'$.isSimulatedMsg') AS simulated,
          json_extract(body,'$.modelInfo.modelName') AS model_name FROM data`));
    }
    return summarizeCursorMetadata(sessions, records, requests);
  } catch {
    // Never return sqlite stderr, SQL, DB paths or private values in reports.
    return fallback('unreadable');
  }
}
