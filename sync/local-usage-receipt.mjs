// Local Usage Receipt v1 validator and machine identity.
// Contract: docs/local-usage-receipt-v1.schema.json and ADR 0001.

import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, fchmodSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, unlinkSync, writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = 'local-usage-receipt.v1';
export const RECEIPT_KIND = 'meow-ops.local-usage-receipt';
export const AUDITED_SCHEMA_PINS = Object.freeze({
  'hermes-schema-20': Object.freeze({ grain: 'pre-task' }),
  'hermes-schema-22': Object.freeze({ grain: 'task-key' }),
  'hermes-schema-23': Object.freeze({ grain: 'task-key' }),
});
export const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'local-usage-receipt-v1.schema.json');

const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FORBIDDEN_KEY_RE = /^(?:prompts?|responses?|content|messages|history|transcripts?|cwd|path|filepath|hostname|host|username|user|email|user_id|api_key|authorization|system_prompt|session_title|first_user_message|display_name|password|credentials?|secret|git_remote)$/i;
const SECRET_RE = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|crsr_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]+|AKIA[A-Z0-9]{12,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PATH_RE = /(?:^|[\s"'`=(])(?:\/(?:Users|home|var|etc|private|opt|root|tmp|usr|Volumes)\/|[A-Za-z]:[\\/]|~\/|\\\\)|(?:[Ff][Ii][Ll][Ee]:)|(?:\/\.\.\/|\\\.\.\\)/;
const REMOTE_RE = /(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)|(?:git@)|(?:\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)/;

function hasControlChars(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

const fail = (reason) => ({ ok: false, reason, receipt: null });
const refuse = (message) => { throw new Error(message); };
const deref = (root, ref) => ref.replace(/^#\//, '').split('/').reduce((node, key) => node[key], root);

function typeOk(type, data) {
  if (type === 'null') return data === null;
  if (type === 'object') return data !== null && typeof data === 'object' && !Array.isArray(data);
  if (type === 'array') return Array.isArray(data);
  if (type === 'integer') return Number.isInteger(data) && Number.isFinite(data);
  if (type === 'number') return typeof data === 'number' && Number.isFinite(data);
  if (type === 'boolean') return typeof data === 'boolean';
  return type === 'string' && typeof data === 'string';
}

function schemaOk(node, data, root) {
  if (node.$ref) return schemaOk(deref(root, node.$ref), data, root);
  if (node.allOf?.some((part) => !schemaOk(part, data, root))) return false;
  if (node.anyOf && !node.anyOf.some((part) => schemaOk(part, data, root))) return false;
  if (node.oneOf && node.oneOf.filter((part) => schemaOk(part, data, root)).length !== 1) return false;
  if (node.not && schemaOk(node.not, data, root)) return false;
  const types = node.type == null ? null : [].concat(node.type);
  if (types && !types.some((type) => typeOk(type, data))) return false;
  if ('const' in node && data !== node.const) return false;
  if (node.enum && !node.enum.includes(data)) return false;
  if (typeof data === 'string' && (
    (node.minLength != null && data.length < node.minLength)
    || (node.maxLength != null && data.length > node.maxLength)
    || (node.pattern && !new RegExp(node.pattern, 'u').test(data))
  )) return false;
  if (typeof data === 'number' && (
    (node.minimum != null && data < node.minimum) || (node.maximum != null && data > node.maximum)
  )) return false;
  if (Array.isArray(data) && (
    (node.minItems != null && data.length < node.minItems)
    || (node.maxItems != null && data.length > node.maxItems)
    || (node.uniqueItems && new Set(data.map((item) => JSON.stringify(item))).size !== data.length)
    || (node.items && data.some((item) => !schemaOk(node.items, item, root)))
  )) return false;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (node.required?.some((key) => !(key in data))) return false;
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
  if (typeof value === 'string') { onString(value); return; }
  if (Array.isArray(value)) { for (const child of value) walk(child, onKey, onString); return; }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) { onKey(key); walk(child, onKey, onString); }
  }
}

function rejectContent(value) {
  let reason = null;
  walk(value, (key) => { if (!reason && FORBIDDEN_KEY_RE.test(key)) reason = 'forbidden_field'; }, (text) => {
    if (reason) return;
    if (hasControlChars(text)) reason = 'control_character';
    else if (SECRET_RE.test(text)) reason = 'secret';
    else if (PATH_RE.test(text) || REMOTE_RE.test(text)) reason = 'identity';
  });
  return reason;
}

export function canonicalDedupeKey(schemaVersion, machineId, harness, sourceEventId) {
  return createHash('sha256')
    .update(JSON.stringify([schemaVersion, machineId, harness, sourceEventId]), 'utf8')
    .digest('hex');
}

export const machineIdPath = (homeDir = homedir()) => join(homeDir, '.meow-ops', 'machine-id');

function lstatOrNull(path) {
  try { return lstatSync(path); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function nearestExisting(path) {
  let current = resolve(path);
  for (;;) {
    if (lstatOrNull(current)) return current;
    const parent = dirname(current);
    if (parent === current) refuse('machine identity path is unresolvable');
    current = parent;
  }
}

export function assertOutsideWorktree(dir) {
  let current = resolve(dir);
  for (;;) {
    if (lstatOrNull(join(current, '.git'))) refuse('machine identity refuses a git worktree');
    const parent = dirname(current);
    if (parent === current) return dir;
    current = parent;
  }
}

function assertSafe(path, kind) {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) refuse(`machine identity refuses a ${kind} symlink`);
  if (kind === 'directory' ? !st.isDirectory() : !st.isFile()) {
    refuse(kind === 'directory' ? 'machine identity refuses a non-directory' : 'machine identity refuses a non-regular file');
  }
}

function ensureIdentityDir(dir) {
  const resolved = resolve(dir);
  const ancestor = nearestExisting(resolved);
  if (ancestor === resolved) assertSafe(resolved, 'directory');
  assertOutsideWorktree(realpathSync(ancestor));
  if (ancestor !== resolved) {
    mkdirSync(resolved, { recursive: true, mode: 0o700 });
    assertSafe(resolved, 'directory');
  }
  assertOutsideWorktree(realpathSync(resolved));
  chmodSync(resolved, 0o700);
}

function createExclusive(path, body) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeSync(fd, body); fchmodSync(fd, 0o600); } finally { closeSync(fd); }
}

function readExistingIdentity(filePath) {
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!UUID_RE.test(raw)) refuse('machine identity is malformed');
  return raw;
}

function readOrCreateAt(filePath) {
  ensureIdentityDir(dirname(filePath));
  if (lstatOrNull(filePath)) {
    assertSafe(filePath, 'machine-id');
    chmodSync(filePath, 0o600);
    return readExistingIdentity(filePath);
  }
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  createExclusive(tmp, `${randomUUID()}\n`);
  try { linkSync(tmp, filePath); } catch (err) {
    if (err.code !== 'EEXIST') {
      try { unlinkSync(tmp); } catch { /* ignore tmp cleanup */ }
      throw err;
    }
  }
  try { unlinkSync(tmp); } catch { /* ignore tmp cleanup */ }
  assertSafe(filePath, 'machine-id');
  chmodSync(filePath, 0o600);
  return readExistingIdentity(filePath);
}

// Tests may pass a temporary home directory. Production omits the argument.
export function readOrCreateMachineId(homeDir) {
  if (homeDir != null && typeof homeDir !== 'string') refuse('machine identity home must be a directory path');
  return readOrCreateAt(machineIdPath(homeDir ?? homedir()));
}

export function validateReceipt(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return fail('malformed');
  if (value.schema_version !== SCHEMA_VERSION || value.kind !== RECEIPT_KIND) return fail('unsupported_version');
  if (!schemaOk(SCHEMA, value, SCHEMA)) return fail('malformed');
  const leak = rejectContent(value);
  if (leak) return fail(leak);
  const seen = new Set();
  for (const event of value.events) {
    if (event.availability?.model !== 'exact' || event.provenance?.recorded_as !== 'invocation') return fail('inventory');
    if (event.provenance?.source_kind === 'receipt') return fail('source_kind');
    if (event.provenance?.source_kind === 'sqlite' && !AUDITED_SCHEMA_PINS[event.provenance.schema_pin]) {
      return fail('schema_pin');
    }
    if (event.tokens) {
      for (const quantity of Object.values(event.tokens)) {
        if (quantity?.available === true && (!Number.isInteger(quantity.value) || quantity.value < 0
          || quantity.provenance !== 'source')) return fail('fractional_token');
      }
    }
    const expected = canonicalDedupeKey(
      value.schema_version, value.machine_id, event.harness, event.source_event_id,
    );
    if (event.dedupe_key !== expected) return fail('dedupe_key');
    if (seen.has(expected)) return fail('duplicate_dedupe_key');
    seen.add(expected);
  }
  return { ok: true, reason: null, receipt: value };
}
