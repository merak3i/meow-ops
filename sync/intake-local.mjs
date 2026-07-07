import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { assertOutsideWorktree, assertRedacted } from './loop-ledger.mjs';
import { callLmStudioJson } from './lmstudio-client.mjs';

export const DEFAULT_LIMIT = 10;
const MAX_CHUNK_CHARS = 16_000;
const TASK_KINDS = new Set(['build', 'debug', 'refactor', 'research', 'content', 'ops', 'other']);
const OUTCOMES = new Set(['completed', 'partial', 'abandoned', 'unknown']);
export const INTAKE_SOURCES = new Set(['claude', 'codex', 'antigravity']);
export const INTAKE_SUMMARY_FIELDS = [
  'intake_id', 'session_id', 'source', 'summarized_at', 'task_kind', 'outcome',
  'failure_signatures', 'waste_indicators', 'friction_score', 'model_calls',
];
const FIELD_TYPES = {
  intake_id: 'string',
  session_id: 'string',
  source: 'string',
  summarized_at: 'string',
  task_kind: 'string',
  outcome: 'string',
  failure_signatures: 'array',
  waste_indicators: 'array',
  friction_score: 'number',
  model_calls: 'number',
};
const GENERIC_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 _.:@-]{0,79}$/;

function defaultClaudeProjectsDir() {
  return join(homedir(), '.claude', 'projects');
}

export function resolveIntakeDir(env = process.env) {
  const dir = resolve(env.MEOW_INTAKE_DIR || join(homedir(), '.meow-ops', 'intake'));
  assertOutsideWorktree(dir);
  return dir;
}

export function newIntakeId() {
  return `intake_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function readIntakeCursor(intakeDir) {
  const cursor = readJson(join(intakeDir, 'cursor.json'), { processed_session_ids: [] });
  return cursor && typeof cursor === 'object' && !Array.isArray(cursor) ? cursor : {};
}

export function cursorIds(cursor, field) {
  const ids = Array.isArray(cursor[field]) ? cursor[field].map(String).filter(Boolean) : [];
  return [...new Set(ids)];
}

export function writeIntakeCursor(intakeDir, cursor) {
  mkdirSync(intakeDir, { recursive: true });
  writeFileSync(join(intakeDir, 'cursor.json'), `${JSON.stringify({
    ...cursor,
    updated_at: new Date().toISOString(),
  }, null, 2)}\n`);
}

export function appendIntakeSummary(intakeDir, summary) {
  mkdirSync(intakeDir, { recursive: true });
  appendFileSync(join(intakeDir, 'summaries.jsonl'), `${JSON.stringify(summary)}\n`, 'utf8');
  return summary;
}

export function writeIntakeJson(intakeDir, fileName, record) {
  mkdirSync(intakeDir, { recursive: true });
  assertRedacted(record, fileName);
  writeFileSync(join(intakeDir, fileName), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function walkJsonl(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonl(path));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push({ path, mtimeMs: statSync(path).mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function textFromValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value)
    .filter(([key]) => !['uuid', 'sessionId', 'parentUuid', 'timestamp', 'version'].includes(key))
    .map(([_key, child]) => textFromValue(child))
    .filter(Boolean)
    .join('\n');
}

function readTranscript(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  let sessionId = basename(path, '.jsonl');
  const chunks = [];
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.sessionId) sessionId = String(entry.sessionId);
    const role = entry.type || entry.message?.role || 'entry';
    const text = textFromValue(entry.message?.content ?? entry.content);
    if (text.trim()) chunks.push(`${role}:\n${text.trim()}`);
  }
  return { sessionId, text: chunks.join('\n\n') };
}

function chunkText(text, maxChars = MAX_CHUNK_CHARS) {
  const value = String(text || '');
  if (!value) return [''];
  const chunks = [];
  for (let i = 0; i < value.length; i += maxChars) chunks.push(value.slice(i, i + maxChars));
  return chunks;
}

function serializeAllowed(record) {
  const out = {};
  for (const field of INTAKE_SUMMARY_FIELDS) {
    if (record[field] !== undefined) out[field] = record[field];
  }
  return out;
}

function fail(rule, message) {
  throw new Error(`[${rule}] ${message}`);
}

function req(record, field, type) {
  const value = record[field];
  if (value === undefined || value === null || value === '') {
    fail('missing-field', `intake summary is missing "${field}"`);
  }
  if (type === 'array') {
    if (!Array.isArray(value)) fail('missing-field', `intake summary "${field}" must be an array`);
  } else if (typeof value !== type) {
    fail('missing-field', `intake summary "${field}" must be a ${type}`);
  }
  return value;
}

function validateLabels(labels, field) {
  for (const [index, label] of labels.entries()) {
    if (typeof label !== 'string' || !GENERIC_LABEL_RE.test(label)) {
      fail('generic-label', `intake summary "${field}[${index}]" must be a short generic label`);
    }
  }
}

export function cleanIntakeSummary(raw, { expectedSessionId, now, modelCalls } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('missing-field', 'intake summary must be an object');
  }
  assertRedacted(raw, 'intake-summary-raw');
  const clean = serializeAllowed(raw);
  for (const [field, type] of Object.entries(FIELD_TYPES)) req(clean, field, type);

  const sessionId = req(clean, 'session_id', 'string');
  if (expectedSessionId && sessionId !== expectedSessionId) {
    fail('session-id', 'intake summary session_id does not match the source session');
  }
  if (!INTAKE_SOURCES.has(req(clean, 'source', 'string'))) fail('source', 'intake summary source is not allowed');
  if (!TASK_KINDS.has(req(clean, 'task_kind', 'string'))) fail('task-kind', 'intake summary task_kind is not allowed');
  if (!OUTCOMES.has(req(clean, 'outcome', 'string'))) fail('outcome', 'intake summary outcome is not allowed');
  validateLabels(req(clean, 'failure_signatures', 'array'), 'failure_signatures');
  validateLabels(req(clean, 'waste_indicators', 'array'), 'waste_indicators');

  const friction = req(clean, 'friction_score', 'number');
  if (!Number.isInteger(friction) || friction < 0 || friction > 5) {
    fail('friction-score', 'intake summary friction_score must be an integer from 0 to 5');
  }
  const calls = req(clean, 'model_calls', 'number');
  if (!Number.isInteger(calls) || calls < 0) {
    fail('model-calls', 'intake summary model_calls must be a non-negative integer');
  }
  if (now) clean.summarized_at = new Date(now).toISOString();
  if (modelCalls !== undefined) clean.model_calls = modelCalls;
  assertRedacted(clean, 'intake-summary');
  return clean;
}

function summaryPrompt({ sessionId, intakeId: id, summarizedAt, chunk, chunkIndex, chunkCount }) {
  return [
    'You are a local-only intake classifier. Return JSON only.',
    'Summarize the transcript into content-free operational metadata.',
    'Never quote user text, file paths, code, commands, secrets, project names, or personal names.',
    'Use only short generic labels like edit-before-read or context-compaction.',
    `Schema fields: ${INTAKE_SUMMARY_FIELDS.join(', ')}.`,
    `Allowed task_kind: ${[...TASK_KINDS].join('|')}.`,
    `Allowed outcome: ${[...OUTCOMES].join('|')}.`,
    `Required constants: intake_id=${id}, session_id=${sessionId}, source=claude, summarized_at=${summarizedAt}.`,
    `This is chunk ${chunkIndex + 1} of ${chunkCount}.`,
    'Transcript chunk follows locally:',
    chunk,
  ].join('\n');
}

function finalPrompt({ sessionId, intakeId: id, summarizedAt, partials }) {
  return [
    'You are a local-only intake classifier. Return JSON only.',
    'Combine these content-free chunk summaries into one content-free operational record.',
    'Never add quotes, file paths, code, commands, secrets, project names, or personal names.',
    `Schema fields: ${INTAKE_SUMMARY_FIELDS.join(', ')}.`,
    `Allowed task_kind: ${[...TASK_KINDS].join('|')}.`,
    `Allowed outcome: ${[...OUTCOMES].join('|')}.`,
    `Required constants: intake_id=${id}, session_id=${sessionId}, source=claude, summarized_at=${summarizedAt}.`,
    'Chunk summaries follow:',
    JSON.stringify(partials),
  ].join('\n');
}

async function callSummary({ prompt, env, transport, notes }) {
  return callLmStudioJson({
    env,
    transport,
    notes,
    messages: [{ role: 'user', content: prompt }],
  });
}

async function summarizeTranscript({ sessionId, text, env, transport, notes, now }) {
  const chunks = chunkText(text);
  const summarizedAt = new Date(now).toISOString();
  const id = newIntakeId();
  let modelCalls = 0;
  const partials = [];

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const raw = await callSummary({
      env,
      transport,
      notes,
      prompt: summaryPrompt({
        sessionId,
        intakeId: id,
        summarizedAt,
        chunk,
        chunkIndex,
        chunkCount: chunks.length,
      }),
    });
    if (!raw) return null;
    modelCalls += 1;
    partials.push(cleanIntakeSummary(raw, {
      expectedSessionId: sessionId,
      now,
      modelCalls: 1,
    }));
  }

  if (partials.length === 1) {
    return { ...partials[0], model_calls: modelCalls };
  }

  const rawFinal = await callSummary({
    env,
    transport,
    notes,
    prompt: finalPrompt({
      sessionId,
      intakeId: id,
      summarizedAt,
      partials,
    }),
  });
  if (!rawFinal) return null;
  modelCalls += 1;
  return cleanIntakeSummary(rawFinal, {
    expectedSessionId: sessionId,
    now,
    modelCalls,
  });
}

export async function runIntake(options = {}) {
  const env = options.env || process.env;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const sourceDir = options.sourceDir || env.MEOW_CLAUDE_PROJECTS_DIR || defaultClaudeProjectsDir();
  const intakeDir = options.intakeDir || resolveIntakeDir(env);
  const transport = options.transport || globalThis.fetch;
  const now = options.now || new Date();
  const notes = options.notes || [];
  const cursor = readIntakeCursor(intakeDir);
  const seen = new Set(cursorIds(cursor, 'processed_session_ids'));
  const files = walkJsonl(sourceDir);
  const stats = {
    scanned: 0,
    processed: 0,
    stored: 0,
    dropped: 0,
    skipped: 0,
    warnings: [],
    notes,
  };

  for (const file of files) {
    if (stats.processed >= limit) break;
    const transcript = readTranscript(file.path);
    if (!transcript.sessionId || seen.has(transcript.sessionId)) continue;
    stats.scanned += 1;
    const noteCount = notes.length;
    let summary;
    try {
      summary = await summarizeTranscript({
        sessionId: transcript.sessionId,
        text: transcript.text,
        env,
        transport,
        notes,
        now,
      });
    } catch (err) {
      stats.dropped += 1;
      stats.warnings.push(err.message.replace(/"[^"]+"/g, '"content not shown"'));
      seen.add(transcript.sessionId);
      stats.processed += 1;
      continue;
    }
    if (!summary) {
      stats.skipped += 1;
      if (notes.slice(noteCount).includes('intake skipped: no local model')) break;
      continue;
    }
    appendIntakeSummary(intakeDir, summary);
    seen.add(transcript.sessionId);
    stats.processed += 1;
    stats.stored += 1;
  }

  if (stats.processed > 0) {
    writeIntakeCursor(intakeDir, { ...cursor, processed_session_ids: [...seen] });
  }
  return stats;
}

function parseArgs(argv) {
  const out = { limit: DEFAULT_LIMIT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') {
      const parsed = Number(argv[i + 1]);
      out.limit = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_LIMIT;
      i += 1;
    }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const stats = await runIntake(parseArgs(argv));
  for (const warning of stats.warnings) console.warn(`warning: ${warning}`);
  for (const value of [...new Set(stats.notes)]) console.log(value);
  console.log(`intake scanned=${stats.scanned} processed=${stats.processed} stored=${stats.stored} dropped=${stats.dropped} skipped=${stats.skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
