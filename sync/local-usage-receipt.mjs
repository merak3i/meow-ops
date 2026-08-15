// Local Usage Receipt v1 validator and machine identity.
// Contract: docs/local-usage-receipt-v1.schema.json and ADR 0001.
// No importer, Hermes adapter, UI, or writer CLI.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = 'local-usage-receipt.v1';
export const RECEIPT_KIND = 'meow-ops.local-usage-receipt';
export const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'local-usage-receipt-v1.schema.json');

const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEYS = new Set([
  'prompt', 'prompts', 'response', 'responses', 'content', 'messages', 'history',
  'transcript', 'transcripts', 'cwd', 'path', 'filepath', 'hostname', 'host',
  'username', 'user', 'email', 'user_id', 'api_key', 'authorization',
  'system_prompt', 'session_title', 'first_user_message', 'display_name',
  'password', 'credential', 'credentials', 'remote', 'git_remote',
]);
const SECRET_RE = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|crsr_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]+|AKIA[A-Z0-9]{12,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const PATH_RE = /(?:^|[\s"'`=(])(?:\/(?:Users|home|var|etc|private|opt|root|Volumes)\/|[A-Za-z]:[\\/]|~\/|\\\\)/;
const REMOTE_RE = /(?:git@|https?:\/\/)[A-Za-z0-9._-]+[:/][A-Za-z0-9._/-]+|(?:\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)/i;

function fail(reason) {
  return { ok: false, reason, receipt: null };
}

function deref(root, ref) {
  return ref.replace(/^#\//, '').split('/').reduce((node, key) => node[key], root);
}

function typeOk(type, data) {
  if (type === 'null') return data === null;
  if (type === 'object') return data !== null && typeof data === 'object' && !Array.isArray(data);
  if (type === 'array') return Array.isArray(data);
  if (type === 'integer') return Number.isInteger(data) && Number.isFinite(data);
  if (type === 'number') return typeof data === 'number' && Number.isFinite(data);
  if (type === 'boolean') return typeof data === 'boolean';
  if (type === 'string') return typeof data === 'string';
  return false;
}

function schemaOk(node, data, root) {
  if (node.$ref) return schemaOk(deref(root, node.$ref), data, root);
  if (node.allOf && node.allOf.some((part) => !schemaOk(part, data, root))) return false;
  if (node.anyOf && !node.anyOf.some((part) => schemaOk(part, data, root))) return false;
  if (node.oneOf && node.oneOf.filter((part) => schemaOk(part, data, root)).length !== 1) return false;
  if (node.not && schemaOk(node.not, data, root)) return false;
  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((type) => typeOk(type, data))) return false;
  }
  if ('const' in node && data !== node.const) return false;
  if (node.enum && !node.enum.includes(data)) return false;
  if (typeof data === 'string') {
    if (node.minLength != null && data.length < node.minLength) return false;
    if (node.maxLength != null && data.length > node.maxLength) return false;
    if (node.pattern && !new RegExp(node.pattern, 'u').test(data)) return false;
  }
  if (typeof data === 'number') {
    if (node.minimum != null && data < node.minimum) return false;
    if (node.maximum != null && data > node.maximum) return false;
  }
  if (Array.isArray(data)) {
    if (node.minItems != null && data.length < node.minItems) return false;
    if (node.maxItems != null && data.length > node.maxItems) return false;
    if (node.uniqueItems && new Set(data.map((item) => JSON.stringify(item))).size !== data.length) return false;
    if (node.items && data.some((item) => !schemaOk(node.items, item, root))) return false;
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (node.required && node.required.some((key) => !(key in data))) return false;
    if (node.additionalProperties === false && node.properties
      && Object.keys(data).some((key) => !(key in node.properties))) return false;
    if (node.properties) {
      for (const [key, value] of Object.entries(data)) {
        if (node.properties[key] && !schemaOk(node.properties[key], value, root)) return false;
      }
    }
  }
  if (node.if) {
    const matched = schemaOk(node.if, data, root);
    if (matched && node.then && !schemaOk(node.then, data, root)) return false;
    if (!matched && node.else && !schemaOk(node.else, data, root)) return false;
  }
  return true;
}

function walk(value, onKey, onString) {
  if (typeof value === 'string') {
    onString(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) walk(child, onKey, onString);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      onKey(key);
      walk(child, onKey, onString);
    }
  }
}

function rejectContent(value) {
  let reason = null;
  walk(value, (key) => {
    if (reason) return;
    if (FORBIDDEN_KEYS.has(key) || /prompt|transcript|username|hostname|password|secret|credential|api[_-]?key/i.test(key)) {
      reason = 'forbidden_field';
    }
  }, (text) => {
    if (reason) return;
    if (SECRET_RE.test(text)) reason = 'secret';
    else if (PATH_RE.test(text) || REMOTE_RE.test(text)) reason = 'identity';
  });
  return reason;
}

function rejectQuantities(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.available === true) {
    if (!('value' in value) || value.provenance !== 'source') return 'provenance';
    if (!Number.isFinite(value.value) || value.value < 0) return 'quantity';
  }
  if (value.available === false && ('value' in value || 'provenance' in value)) return 'unavailable_value';
  return null;
}

function rejectTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return null;
  for (const quantity of Object.values(tokens)) {
    if (!quantity || typeof quantity !== 'object') continue;
    if (quantity.available === true) {
      if (quantity.provenance !== 'source') return 'provenance';
      if (!Number.isInteger(quantity.value) || !Number.isFinite(quantity.value) || quantity.value < 0) {
        return 'fractional_token';
      }
    }
  }
  return null;
}

export function canonicalDedupeKey(schemaVersion, machineId, harness, sourceEventId) {
  return createHash('sha256')
    .update(JSON.stringify([schemaVersion, machineId, harness, sourceEventId]), 'utf8')
    .digest('hex');
}

export function defaultMachineIdPath() {
  return join(homedir(), '.meow-ops', 'machine-id');
}

export function assertOutsideWorktree(dir) {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, '.git'))) {
      throw new Error('machine identity refuses a git worktree');
    }
    const parent = dirname(current);
    if (parent === current) return dir;
    current = parent;
  }
}

function readOrCreateAt(path) {
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').trim();
    if (!UUID_RE.test(raw)) {
      throw new Error('machine_id file is not a random UUID; refusing to invent a replacement');
    }
    return raw.toLowerCase();
  }
  const id = randomUUID();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${id}\n`, { encoding: 'utf8', mode: 0o600 });
  return id;
}

// Production never passes options. Tests inject options.path. There is no
// environment flag that can disable the worktree check.
export function readOrCreateMachineId(options = {}) {
  if (options && options.path) return readOrCreateAt(options.path);
  const path = defaultMachineIdPath();
  assertOutsideWorktree(dirname(path));
  return readOrCreateAt(path);
}

export function validateReceipt(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return fail('malformed');
  if (value.schema_version !== SCHEMA_VERSION) return fail('unsupported_version');
  if (!schemaOk(SCHEMA, value, SCHEMA)) return fail('malformed');
  const leak = rejectContent(value);
  if (leak) return fail(leak);
  for (const event of value.events) {
    if (!event.model) return fail('missing_model');
    if (event.availability?.model !== 'exact') return fail('inventory');
    if (event.provenance?.recorded_as !== 'invocation') return fail('inventory');
    const tokenReason = rejectTokens(event.tokens);
    if (tokenReason) return fail(tokenReason);
    const costReason = rejectQuantities(event.cost_usd);
    if (costReason) return fail(costReason);
    const expected = canonicalDedupeKey(value.schema_version, value.machine_id, event.harness, event.source_event_id);
    if (event.dedupe_key !== expected) return fail('dedupe_key');
  }
  return { ok: true, reason: null, receipt: value };
}
