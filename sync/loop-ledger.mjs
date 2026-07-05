// Loop Ledger — the single write choke point for Loop Engineering data.
//
// Canonical store is append-only JSONL in ~/.meow-ops/loop-ledger, OUTSIDE
// the git worktree by construction: no .gitignore mistake, `git add -f`, or
// working-dir upload can ever publish it. Every append goes through
// validate → allowlist-serialize → assertRedacted, so an unredacted or
// malformed record never reaches disk (redaction at the exporter, not
// downstream — the 2026-06-12 lesson).

import {
  appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync,
  statSync, unlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  ALLOWED_FIELDS, SCHEMA_VERSION, VALIDATORS, validateStatusTransition,
} from './loop-schema.mjs';

const ENTITY_FILES = {
  run: 'runs.jsonl',
  comparison: 'comparisons.jsonl',
  proposal: 'proposals.jsonl',
  decision: 'decisions.jsonl',
};

// Content-bearing session fields must never enter the ledger under any key.
const FORBIDDEN_KEYS = ['cwd', 'session_title', 'first_user_message'];

// sha256 hex (e.g. a future rollback.prior_sha256) is not a secret; strip
// pure-hex runs before the base64 rule so hashes don't false-positive.
const HEX_RUN_RE = /\b[0-9a-f]{40,64}\b/g;

const SECRET_RULES = [
  { id: 'abs-home-path', re: /\/Users\// },
  { id: 'anthropic-key', re: /\bsk-[A-Za-z0-9_-]{8,}/ },
  { id: 'github-token', re: /\bghp_[A-Za-z0-9]{10,}/ },
  { id: 'google-oauth', re: /GOCSPX-/ },
  { id: 'supabase-secret', re: /\bsb_secret_/ },
  { id: 'resend-key', re: /\bre_[A-Za-z0-9]{16,}/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{20,}/ },
  { id: 'base64-run', re: /[A-Za-z0-9+/]{41,}={0,2}/ },
];

export function resolveLedgerDir() {
  const dir = resolve(process.env.MEOW_LOOP_DIR || join(homedir(), '.meow-ops', 'loop-ledger'));
  assertOutsideWorktree(dir);
  return dir;
}

// MEOW_LOOP_DIR exists for tests, but it must never silently point the
// "structurally safe" ledger back inside a git worktree.
export function assertOutsideWorktree(dir) {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, '.git'))) {
      throw new Error(`[worktree-guard] ledger dir ${dir} is inside a git worktree (${current}) — refusing`);
    }
    const parent = dirname(current);
    if (parent === current) return dir;
    current = parent;
  }
}

function loadConfidentialDenylist() {
  const path = join(homedir(), '.meow-ops', 'confidential-denylist.json');
  if (!existsSync(path)) return [];
  try {
    const list = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(list) ? list.map((s) => String(s).toLowerCase()).filter(Boolean) : [];
  } catch {
    throw new Error('[confidential-denylist] ~/.meow-ops/confidential-denylist.json exists but is not a JSON array');
  }
}

function findForbiddenKey(value, path = '') {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const keyPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.includes(key)) return keyPath;
    const nested = findForbiddenKey(child, keyPath);
    if (nested) return nested;
  }
  return null;
}

// Rejection errors name the entity + rule + key path only — NEVER the
// matched content, so even a public CI log cannot republish what was caught.
export function assertRedacted(record, entity = 'record') {
  const badKey = findForbiddenKey(record);
  if (badKey) {
    throw new Error(`[forbidden-key] ${entity} rejected: content-bearing key at "${badKey}" (content not shown)`);
  }
  const serialized = JSON.stringify(record);
  const scannable = serialized.replace(HEX_RUN_RE, '');
  for (const { id, re } of SECRET_RULES) {
    if (re.test(scannable)) {
      throw new Error(`[${id}] ${entity} rejected by secret rule "${id}" (content not shown)`);
    }
  }
  const lowered = serialized.toLowerCase();
  for (const token of loadConfidentialDenylist()) {
    if (lowered.includes(token)) {
      throw new Error(`[confidential-denylist] ${entity} rejected: contains a denylisted slug (content not shown)`);
    }
  }
  return record;
}

// Unknown keys are DROPPED, not scanned-and-hoped: a denylist cannot catch
// novel secret formats in free-text fields, but an allowlist never has to.
export function serializeAllowed(entity, record) {
  const allowed = ALLOWED_FIELDS[entity];
  if (!allowed) throw new Error(`[unknown-entity] no allowlist for entity "${entity}"`);
  const out = {};
  for (const field of allowed) {
    if (record[field] !== undefined) out[field] = record[field];
  }
  out.schema_version = SCHEMA_VERSION;
  return out;
}

function withLock(lockPath, fn) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        return fn();
      } finally {
        closeSync(fd);
        unlinkSync(lockPath);
      }
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 5000) unlinkSync(lockPath); // stale lock
      } catch { /* lock vanished between checks — fine */ }
      const until = Date.now() + 10;
      while (Date.now() < until); // brief sync backoff; callers are CLIs
    }
  }
  throw new Error(`[ledger-lock] could not acquire ${lockPath} after 2s`);
}

function readLedgerFile(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function enforceProposalStatusFlow(file, clean) {
  const prior = foldLatestById(readLedgerFile(file), 'proposal_id')
    .find((record) => record.proposal_id === clean.proposal_id);
  if (!prior) {
    if (clean.status !== 'draft') {
      throw new Error('[status-flow] first proposal record must start as "draft"');
    }
    return;
  }
  if (prior.status !== clean.status) validateStatusTransition(prior.status, clean.status);
}

export function appendRecord(entity, record) {
  const validate = VALIDATORS[entity];
  if (!validate) throw new Error(`[unknown-entity] "${entity}" is not a ledger entity`);
  const clean = serializeAllowed(entity, record);
  validate(clean);
  assertRedacted(clean, entity);
  const dir = resolveLedgerDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, ENTITY_FILES[entity]);
  withLock(`${file}.lock`, () => {
    if (entity === 'proposal') enforceProposalStatusFlow(file, clean);
    appendFileSync(file, `${JSON.stringify(clean)}\n`, 'utf8');
  });
  return clean;
}

export function readLedger(entity) {
  if (!ENTITY_FILES[entity]) throw new Error(`[unknown-entity] "${entity}" is not a ledger entity`);
  const file = join(resolveLedgerDir(), ENTITY_FILES[entity]);
  return readLedgerFile(file);
}

// Latest-appended record wins per id — supersede by appending, never edit.
export function foldLatestById(records, idField) {
  const byId = new Map();
  for (const record of records) byId.set(record[idField], record);
  return [...byId.values()];
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}
