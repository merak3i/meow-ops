// Project Intelligence ledger — append-only owner knowledge stored outside the
// git worktree. The ledger stores short, allowlisted project facts only; raw
// prompts, transcript content, cwd values, and arbitrary metadata are rejected.

import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { assertOutsideWorktree, assertRedacted, newId } from './loop-ledger.mjs';

export const PROJECT_FIELDS = [
  'mission', 'vision', 'current_phase', 'outcome', 'constraint', 'non_goal', 'priority', 'alias',
];
export const CLAIM_STATUSES = ['inferred', 'owner_confirmed', 'stale', 'contradicted'];
const CLAIM_SOURCES = ['owner', 'project_doc', 'repo', 'session_pattern', 'system'];
const FILE_NAME = 'claims.jsonl';

export function resolveProjectIntelligenceDir() {
  const dir = resolve(
    process.env.MEOW_PROJECT_INTELLIGENCE_DIR
      || join(homedir(), '.meow-ops', 'project-intelligence'),
  );
  assertOutsideWorktree(dir);
  return dir;
}

export function projectId(value) {
  const id = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  if (!id) throw new Error('[project-id] project name must contain letters or numbers');
  return id;
}

function text(value, field, max) {
  const clean = String(value || '').trim();
  if (!clean || clean.length > max) {
    throw new Error(`[project-claim] ${field} must be 1-${max} characters`);
  }
  return clean;
}

function validateClaim(input) {
  const project_name = text(input.project_name, 'project_name', 100);
  const field = text(input.field, 'field', 40);
  const value = text(input.value, 'value', 4000);
  const status = input.status || 'owner_confirmed';
  const source = input.source || 'owner';
  if (!PROJECT_FIELDS.includes(field)) throw new Error(`[project-claim] unsupported field "${field}"`);
  if (!CLAIM_STATUSES.includes(status)) throw new Error(`[project-claim] unsupported status "${status}"`);
  if (!CLAIM_SOURCES.includes(source)) throw new Error(`[project-claim] unsupported source "${source}"`);
  const confidence = input.confidence === undefined
    ? (status === 'owner_confirmed' ? 1 : 0.65)
    : Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('[project-claim] confidence must be between 0 and 1');
  }
  const recorded_at = input.recorded_at || new Date().toISOString();
  if (!Number.isFinite(Date.parse(recorded_at))) throw new Error('[project-claim] recorded_at must be ISO-8601');

  return assertRedacted({
    schema_version: 1,
    claim_id: input.claim_id ? text(input.claim_id, 'claim_id', 120) : newId('claim'),
    project_id: projectId(input.project_id || project_name),
    project_name,
    field,
    value,
    status,
    source,
    confidence,
    recorded_at,
    ...(input.supersedes ? { supersedes: text(input.supersedes, 'supersedes', 120) } : {}),
  }, 'project-claim');
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
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 5000) unlinkSync(lockPath);
      } catch { /* another writer released it */ }
      const until = Date.now() + 10;
      while (Date.now() < until); // bounded synchronous backoff for local CLI writes
    }
  }
  throw new Error('[project-ledger-lock] could not acquire ledger lock');
}

export function appendProjectClaim(input) {
  const claim = validateClaim(input || {});
  const dir = resolveProjectIntelligenceDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, FILE_NAME);
  withLock(`${file}.lock`, () => appendFileSync(file, `${JSON.stringify(claim)}\n`, 'utf8'));
  return claim;
}

export function readProjectClaims() {
  const file = join(resolveProjectIntelligenceDir(), FILE_NAME);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function foldProjectClaims(claims) {
  const latest = new Map();
  for (const claim of Array.isArray(claims) ? claims : []) {
    latest.set(`${claim.project_id}:${claim.field}`, claim);
  }
  return [...latest.values()];
}

export function confirmProjectClaim(claimId) {
  const id = text(claimId, 'claim_id', 120);
  const prior = [...readProjectClaims()].reverse().find((claim) => claim.claim_id === id);
  if (!prior) throw new Error('[project-claim] claim not found');
  if (prior.status === 'owner_confirmed') return prior;
  return appendProjectClaim({
    ...prior,
    claim_id: prior.claim_id,
    status: 'owner_confirmed',
    source: 'owner',
    confidence: 1,
    recorded_at: new Date().toISOString(),
  });
}
