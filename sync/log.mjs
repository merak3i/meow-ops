// Structured JSON logger for the sync tier (SHIP-GATE check 18). Zero dependencies.
//
// One JSON object per line: info/debug on stdout, warn/error on stderr, so launchd's
// StandardOutPath / StandardErrorPath split stays meaningful and automation-health.mjs
// can keep parsing the error log. Every line carries the bound fields (component, run_id)
// so one run can be followed with `grep '"run_id":"<id>"' ~/Library/Logs/meow-ops/*.log`.
//
// Redaction mirrors automation-health.mjs: API-key shapes, JWTs, long base64 blobs and
// absolute home paths never reach a log line. LOG_FORMAT=pretty for a terminal.

import { randomUUID } from 'node:crypto';

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

const SECRET_REPLACERS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bghp_[A-Za-z0-9]{10,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  new RegExp(`${'GOCSPX'}-[A-Za-z0-9_-]+`, 'g'),
  new RegExp(`\\b${'sb_secret'}_[A-Za-z0-9_-]+`, 'g'),
  /\bre_[A-Za-z0-9]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{20,}/g,
  /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, // telegram bot tokens
  /[A-Za-z0-9+/]{41,}={0,2}/g,
];
const HOME_RE = /\/(?:Users|home)\/[^\s'"<>/]+/g;
const FORBIDDEN_KEYS = new Set(['authorization', 'apikey', 'api_key', 'password', 'secret', 'token', 'cookie', 'body', 'payload']);

export function redact(value) {
  let text = String(value ?? '');
  for (const re of SECRET_REPLACERS) text = text.replace(re, '[redacted]');
  text = text.replace(HOME_RE, '~');
  return text;
}

function cleanFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) continue;
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = redact(value).slice(0, 400);
    else if (Array.isArray(value)) out[key] = value.slice(0, 20).map((item) => redact(typeof item === 'string' ? item : JSON.stringify(item)).slice(0, 120));
  }
  return out;
}

export function serializeError(error) {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) {
    const out = { name: error.name, message: redact(error.message) };
    if (error.code) out.code = String(error.code);
    if (error.stack && process.env.LOG_STACK !== '0') out.stack = redact(String(error.stack).split('\n').slice(0, 6).join('\n'));
    return out;
  }
  return { message: redact(String(error)) };
}

export function formatLine(record, format = 'json') {
  if (format === 'pretty') {
    const { ts, level, msg, ...rest } = record;
    const tail = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
    return `${ts} ${level.toUpperCase().padEnd(5)} ${msg}${tail}`;
  }
  return JSON.stringify(record);
}

export function newRunId() {
  return randomUUID();
}

export function createLogger(bound = {}, {
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  now = () => new Date(),
} = {}) {
  const minLevel = LEVELS[String(env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
  const format = String(env.LOG_FORMAT || '').toLowerCase() === 'pretty' ? 'pretty' : 'json';
  const base = cleanFields(bound);

  function emit(level, msg, fields = {}) {
    if (LEVELS[level] < minLevel) return;
    const { error, ...plain } = fields || {};
    const record = { ts: now().toISOString(), level, msg: redact(msg), ...base, ...cleanFields(plain) };
    if (error !== undefined) record.error = serializeError(error);
    (LEVELS[level] >= LEVELS.warn ? stderr : stdout).write(formatLine(record, format) + '\n');
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (extra = {}) => createLogger({ ...bound, ...extra }, { env, stdout, stderr, now }),
    bound: () => ({ ...base }),
  };
}

export const log = createLogger({ component: 'meow-ops' });
