// Private, append-only project evidence vault.
//
// Canonical evidence is partitioned JSONL so retention never depends on an
// index. Search indexes may be rebuilt later from these files. All content is
// redacted before hashing and writing; files are private and kept outside Git.

import {
  appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { assertHistoryOutsideWorktree } from './session-history.mjs';

export const AGENT_EVENT_SOURCES = ['antigravity', 'claude', 'codex', 'cursor', 'hermes'];
export const EVIDENCE_SENSITIVITY = ['public', 'internal', 'private', 'restricted'];
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|github_pat|glpat|xox[baprs])[-_A-Za-z0-9]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(authorization\s*:\s*(?:bearer|token)\s+)[^\s,;]+/gi,
  /\b(api[_ -]?key|secret|password|token)\s*[:=]\s*['"]?[^\s,'";]{8,}/gi,
];

const text = (value, field, max = 1_000_000) => {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new Error(`[project-evidence] invalid ${field}`);
  return result;
};

const safePart = (value, field) => {
  const result = text(value, field, 120).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(result)) throw new Error(`[project-evidence] unsafe ${field}`);
  return result;
};

const hash = (value) => createHash('sha256').update(String(value)).digest('hex');

export function redactEvidenceText(value) {
  let result = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (...args) => {
      const prefix = typeof args[1] === 'string' && /authorization/i.test(args[1]) ? args[1] : '';
      return `${prefix}[redacted]`;
    });
  }
  return result;
}

function redactValue(value) {
  if (typeof value === 'string') return redactEvidenceText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactValue(child)]));
}

export function resolveEvidenceDir(dir = process.env.MEOW_EVIDENCE_DIR) {
  const resolved = resolve(dir || join(homedir(), '.meow-ops', 'evidence'));
  assertHistoryOutsideWorktree(resolved);
  return resolved;
}

export function normalizeAgentEvent(input = {}) {
  const source = safePart(input.source, 'source');
  if (!AGENT_EVENT_SOURCES.includes(source)) throw new Error('[project-evidence] unsupported source');
  const project_id = safePart(input.project_id, 'project_id');
  const session_id = text(input.session_id, 'session_id', 500);
  const timestamp = new Date(text(input.timestamp, 'timestamp', 80)).toISOString();
  const event_type = safePart(input.event_type, 'event_type');
  const sensitivity = input.sensitivity || 'private';
  if (!EVIDENCE_SENSITIVITY.includes(sensitivity)) throw new Error('[project-evidence] invalid sensitivity');
  const content = redactEvidenceText(input.content || '');
  const metadata = redactValue(input.metadata && typeof input.metadata === 'object' ? input.metadata : {});
  const raw_ref = text(input.raw_ref, 'raw_ref', 4_000);
  const canonical = {
    source, project_id, session_id, timestamp, event_type, content, metadata, raw_ref, sensitivity,
    ...(input.parent_session_id ? { parent_session_id: String(input.parent_session_id) } : {}),
    ...(input.actor ? { actor: String(input.actor) } : {}),
    ...(input.approval_state ? { approval_state: String(input.approval_state) } : {}),
    ...(input.outcome ? { outcome: String(input.outcome) } : {}),
  };
  const content_hash = hash(JSON.stringify(canonical));
  return {
    event_id: `evt_${content_hash.slice(0, 24)}`,
    ...canonical,
    content_hash,
    schema_version: 1,
  };
}

function partitionPath(dir, event) {
  const month = event.timestamp.slice(0, 7);
  return join(dir, 'events', event.project_id, event.source, `${month}.jsonl`);
}

function existingHashes(path) {
  if (!existsSync(path)) return new Set();
  const hashes = new Set();
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    try {
      const row = JSON.parse(line);
      if (row.content_hash) hashes.add(row.content_hash);
    } catch {
      throw new Error(`[project-evidence] invalid append-only partition: ${path}`);
    }
  }
  return hashes;
}

export function appendAgentEvents(inputs, options = {}) {
  const dir = resolveEvidenceDir(options.dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const byPartition = new Map();
  for (const input of Array.isArray(inputs) ? inputs : []) {
    const event = normalizeAgentEvent(input);
    const path = partitionPath(dir, event);
    const rows = byPartition.get(path) || [];
    rows.push(event);
    byPartition.set(path, rows);
  }

  let appended = 0;
  let duplicates = 0;
  for (const [path, events] of byPartition) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const seen = existingHashes(path);
    const fresh = [];
    for (const event of events) {
      if (seen.has(event.content_hash)) {
        duplicates++;
      } else {
        seen.add(event.content_hash);
        fresh.push(event);
      }
    }
    if (fresh.length > 0) {
      appendFileSync(path, `${fresh.map((event) => JSON.stringify(event)).join('\n')}\n`, {
        encoding: 'utf8', mode: 0o600,
      });
      chmodSync(path, 0o600);
      appended += fresh.length;
    }
  }
  return { appended, duplicates, dir };
}

function* jsonlFiles(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let stat;
    try { stat = statSync(path); } catch { continue; }
    if (stat.isDirectory()) yield* jsonlFiles(path);
    else if (name.endsWith('.jsonl')) yield path;
  }
}

function readAllEvents(dir) {
  const events = [];
  for (const file of jsonlFiles(join(dir, 'events'))) {
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      try { events.push(JSON.parse(line)); }
      catch { throw new Error(`[project-evidence] invalid append-only partition: ${file}`); }
    }
  }
  return events;
}

function sql(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

export function evidenceIndexPath(dir = process.env.MEOW_EVIDENCE_DIR) {
  return join(resolveEvidenceDir(dir), 'index', 'evidence.sqlite3');
}

export function rebuildEvidenceIndex(options = {}) {
  const dir = resolveEvidenceDir(options.dir);
  const path = evidenceIndexPath(dir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) unlinkSync(path);
  const events = readAllEvents(dir);
  const statements = [
    'PRAGMA journal_mode=WAL;',
    'CREATE TABLE events (event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source TEXT NOT NULL, session_id TEXT NOT NULL, timestamp TEXT NOT NULL, event_type TEXT NOT NULL, sensitivity TEXT NOT NULL, raw_json TEXT NOT NULL);',
    'CREATE INDEX idx_events_project_time ON events(project_id, timestamp DESC);',
    'CREATE INDEX idx_events_source ON events(source);',
    "CREATE VIRTUAL TABLE events_fts USING fts5(event_id UNINDEXED, content, metadata, tokenize='unicode61');",
  ];
  for (const event of events) {
    statements.push(
      `INSERT INTO events VALUES (${[
        event.event_id, event.project_id, event.source, event.session_id, event.timestamp,
        event.event_type, event.sensitivity, JSON.stringify(event),
      ].map(sql).join(',')});`,
      `INSERT INTO events_fts(event_id, content, metadata) VALUES (${sql(event.event_id)},${sql(event.content)},${sql(JSON.stringify(event.metadata))});`,
    );
  }
  execFileSync('sqlite3', [path], {
    input: `${statements.join('\n')}\n`,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  chmodSync(path, 0o600);
  return { ok: true, path, events: events.length, rebuildable: true };
}

export function searchEvidenceIndex(options = {}) {
  const path = evidenceIndexPath(options.dir);
  if (!existsSync(path)) return null;
  const terms = String(options.search || '').toLowerCase().match(/[a-z0-9_-]+/g) || [];
  if (terms.length === 0) return null;
  const query = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
  const limitValue = Number.parseInt(options.limit ?? DEFAULT_PAGE_SIZE, 10);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(limitValue) ? limitValue : DEFAULT_PAGE_SIZE));
  const predicates = [`events_fts MATCH ${sql(query)}`];
  if (options.project_id) predicates.push(`events.project_id = ${sql(options.project_id)}`);
  if (options.source) predicates.push(`events.source = ${sql(options.source)}`);
  const output = execFileSync('sqlite3', ['-readonly', '-json', path, `
    SELECT events.raw_json
    FROM events_fts
    JOIN events ON events.event_id = events_fts.event_id
    WHERE ${predicates.join(' AND ')}
    ORDER BY events.timestamp DESC
    LIMIT ${limit}
  `], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  const rows = output ? JSON.parse(output) : [];
  return {
    items: rows.map((row) => JSON.parse(row.raw_json)),
    limit,
    indexed: true,
  };
}

export function queryAgentEvidence(options = {}) {
  const dir = resolveEvidenceDir(options.dir);
  const limitValue = Number.parseInt(options.limit ?? DEFAULT_PAGE_SIZE, 10);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(limitValue) ? limitValue : DEFAULT_PAGE_SIZE));
  const from = options.from ? Date.parse(options.from) : null;
  const to = options.to ? Date.parse(options.to) : null;
  const search = String(options.search || '').trim().toLowerCase();
  const filtered = readAllEvents(dir).filter((event) => {
    if (options.project_id && event.project_id !== options.project_id) return false;
    if (options.source && event.source !== options.source) return false;
    if (options.event_type && event.event_type !== options.event_type) return false;
    const time = Date.parse(event.timestamp);
    if (Number.isFinite(from) && time < from) return false;
    if (Number.isFinite(to) && time > to) return false;
    if (search && !`${event.content} ${JSON.stringify(event.metadata)}`.toLowerCase().includes(search)) return false;
    return true;
  }).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))
    || String(a.event_id).localeCompare(String(b.event_id)));
  const unique = (field) => [...new Set(filtered.map((event) => event[field]).filter(Boolean))].sort();
  return {
    items: filtered.slice(0, limit),
    total: filtered.length,
    limit,
    facets: { sources: unique('source'), event_types: unique('event_type') },
  };
}

export function sessionToAgentEvent(session = {}, options = {}) {
  return normalizeAgentEvent({
    source: session.source,
    project_id: options.project_id,
    session_id: session.session_id,
    parent_session_id: session.parent_session_id,
    timestamp: session.ended_at || session.started_at,
    event_type: 'session_summary',
    content: session.session_title || session.first_user_message || 'Session summary',
    raw_ref: options.raw_ref || `${session.source}:${session.session_id}`,
    sensitivity: options.sensitivity || 'private',
    outcome: session.is_ghost ? 'incomplete' : 'observed',
    metadata: {
      project: session.project,
      model: session.model,
      tools: session.tools || {},
      message_count: session.message_count || 0,
      total_tokens: session.total_tokens || 0,
      duration_seconds: session.duration_seconds || 0,
      usage_available: session.usage_available !== false,
    },
  });
}

function rawPath(rawRef) {
  const value = String(rawRef || '');
  if (existsSync(value)) return value;
  const withoutLine = value.replace(/:\d+(?::\d+)?$/, '');
  return existsSync(withoutLine) ? withoutLine : null;
}

export function archiveRawTextArtifact(input = {}, options = {}) {
  const dir = resolveEvidenceDir(options.dir);
  const sourcePath = rawPath(input.raw_ref);
  if (!sourcePath) return { archived: false, reason: 'source-missing' };
  const stat = statSync(sourcePath);
  const maxBytes = Number(options.maxBytes) || 64 * 1024 * 1024;
  if (!stat.isFile()) return { archived: false, reason: 'source-not-file' };
  if (stat.size > maxBytes) return { archived: false, reason: 'source-too-large', bytes: stat.size };
  const raw = readFileSync(sourcePath);
  if (raw.subarray(0, Math.min(raw.length, 8_192)).includes(0)) {
    return { archived: false, reason: 'source-binary', bytes: stat.size };
  }
  const content = redactEvidenceText(raw.toString('utf8'));
  const contentHash = hash(content);
  const source = safePart(input.source, 'source');
  const projectId = safePart(input.project_id, 'project_id');
  const relative = join('blobs', projectId, source, `${contentHash}.txt`);
  const path = join(dir, relative);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
    chmodSync(path, 0o600);
  }
  const event = normalizeAgentEvent({
    source,
    project_id: projectId,
    session_id: input.session_id,
    timestamp: input.timestamp,
    event_type: 'raw_artifact',
    content: `Archived redacted ${source} source artifact.`,
    raw_ref: input.raw_ref,
    sensitivity: 'restricted',
    metadata: { blob_ref: relative, bytes: Buffer.byteLength(content), content_hash: contentHash },
  });
  const stored = appendAgentEvents([event], { dir });
  return { archived: true, blob_ref: relative, content_hash: contentHash, ...stored };
}

export function archiveSessionEvidence(sessions, options = {}) {
  const catalog = Array.isArray(options.catalog) ? options.catalog : [];
  const projectByName = new Map();
  for (const project of catalog) {
    for (const name of [project.name, ...(project.aliases || [])]) {
      projectByName.set(String(name).trim().toLowerCase(), project);
    }
  }
  const events = [];
  const artifacts = [];
  let skipped = 0;
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const project = projectByName.get(String(session.project || '').trim().toLowerCase());
    if (!project || !AGENT_EVENT_SOURCES.includes(session.source)) {
      skipped++;
      continue;
    }
    events.push(sessionToAgentEvent(session, {
      project_id: project.project_id,
      raw_ref: session.raw_ref || `${session.source}:${session.session_id}`,
    }));
    if (session.raw_ref) {
      artifacts.push({
        source: session.source,
        project_id: project.project_id,
        session_id: session.session_id,
        timestamp: session.ended_at || session.started_at,
        raw_ref: session.raw_ref,
      });
    }
  }
  const stored = appendAgentEvents(events, options);
  let artifactsArchived = 0;
  let artifactsSkipped = 0;
  for (const artifact of artifacts) {
    const result = archiveRawTextArtifact(artifact, options);
    if (result.archived) artifactsArchived++;
    else artifactsSkipped++;
  }
  return {
    ...stored,
    considered: events.length,
    skipped,
    artifactsArchived,
    artifactsSkipped,
  };
}

export function archiveMessageEvidence(messages, options = {}) {
  const catalog = Array.isArray(options.catalog) ? options.catalog : [];
  const projectByName = new Map();
  for (const project of catalog) {
    for (const name of [project.name, ...(project.aliases || [])]) {
      projectByName.set(String(name).trim().toLowerCase(), project);
    }
  }
  const events = [];
  let skipped = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    const project = projectByName.get(String(message.project || '').trim().toLowerCase());
    if (!project || !AGENT_EVENT_SOURCES.includes(message.source)) {
      skipped++;
      continue;
    }
    events.push(normalizeAgentEvent({ ...message, project_id: project.project_id }));
  }
  return { ...appendAgentEvents(events, options), considered: events.length, skipped };
}
