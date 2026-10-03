import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSessionReconciliation, stageSessionReconciliation } from '../session-reconciliation.mjs';
import { readSessionHistorySnapshot, updateSessionHistory } from '../session-history.mjs';

const row = (session_id, overrides = {}) => ({ source: 'codex', session_id, total_tokens: 10, ...overrides });

test('reconciliation counts exact identity copies once and retains source-only sessions', () => {
  const archives = [
    { sessions: [row('shared'), row('old-only')] },
    { sessions: [{ total_tokens: 10, session_id: 'shared', source: 'codex' }, row('active-only')] },
  ];
  const before = structuredClone(archives);
  const result = planSessionReconciliation(archives);
  assert.equal(result.summary.inputSessions, 4);
  assert.equal(result.summary.uniqueIdentities, 3);
  assert.equal(result.summary.duplicateCopies, 1);
  assert.equal(result.summary.safeSessions, 3);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(archives, before, 'the reconciliation preview never edits its inputs');
});

test('divergent revisions are preserved for review and never summed or silently selected', () => {
  const result = planSessionReconciliation([
    { updatedAt: '2026-10-01T00:00:00Z', sessions: [row('one', { total_tokens: 100 }), row('safe')] },
    { updatedAt: '2026-10-02T00:00:00Z', sessions: [row('one', { total_tokens: 50 })] },
    { sessions: [row('one', { total_tokens: 100 })] },
  ]);
  assert.equal(result.summary.uniqueIdentities, 2);
  assert.equal(result.summary.conflictingIdentities, 1);
  assert.equal(result.summary.duplicateCopies, 1);
  assert.deepEqual(result.sessions.map(session => session.session_id), ['safe']);
  assert.deepEqual(result.conflicts[0].variants.map(variant => variant.session.total_tokens), [100, 50]);
  assert.deepEqual(result.conflicts[0].variants[0].archiveIndexes, [0, 2]);
});

test('native identity namespaces prevent cross-source collisions and do not guess from activity', () => {
  const result = planSessionReconciliation([
    { sessions: [row('one', { model: 'same', project: 'same' })] },
    { sessions: [row('two', { model: 'same', project: 'same' }), row('one', { source: 'hermes' })] },
  ]);
  assert.equal(result.summary.uniqueIdentities, 3);
  assert.equal(result.sessions.length, 3);
});

test('a documented Codex prefix migration deduplicates the same UUID without merging other names', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const result = planSessionReconciliation([
    { sessions: [row(id), row('plain')] },
    { sessions: [row(`codex-${id}`), row('codex-plain')] },
  ]);
  assert.equal(result.summary.uniqueIdentities, 3);
  assert.equal(result.summary.normalizedIdentities, 1);
  assert.equal(result.sessions.filter(session => session.session_id === `codex-${id}`).length, 1);
});

test('invalid identities and content-bearing input cannot enter a reconciliation proposal', () => {
  assert.throws(() => planSessionReconciliation([{ sessions: [row('', { source: 'codex' })] }]), /identity/);
  assert.throws(() => planSessionReconciliation([{ sessions: [row('one', { source: null })] }]), /identity/);
  assert.throws(() => planSessionReconciliation([{ sessions: [row('one', { metadata: { raw_ref: '/private' } })] }]), /content-bearing/);
});

test('CLI reports aggregate counts without exposing records or editing either archive', () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-reconcile-preview-'));
  try {
    const dirs = [join(root, 'old'), join(root, 'active')];
    for (const dir of dirs) updateSessionHistory([row('private-session', { project: 'private-project' })], { dir });
    const before = dirs.map(dir => readFileSync(join(dir, 'current.json')));
    const stdout = execFileSync(process.execPath, [fileURLToPath(new URL('../session-reconciliation.mjs', import.meta.url)), ...dirs], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    });
    assert.doesNotMatch(stdout, /private-session|private-project|meow-reconcile-preview/);
    assert.equal(JSON.parse(stdout).safeSessions, 1);
    assert.equal(JSON.parse(stdout).duplicateCopies, 1);
    dirs.forEach((dir, index) => assert.deepEqual(readFileSync(join(dir, 'current.json')), before[index]));
    const candidate = join(root, 'candidate');
    const staged = execFileSync(process.execPath, [fileURLToPath(new URL('../session-reconciliation.mjs', import.meta.url)), '--stage', candidate, ...dirs], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    });
    assert.doesNotMatch(staged, /private-session|private-project|meow-reconcile-preview/);
    assert.equal(JSON.parse(staged).candidateSessions, 1);
    assert.equal(JSON.parse(staged).status, 'ready-for-owner-review');
    assert.equal(statSync(candidate).mode & 0o777, 0o700);
    assert.equal(statSync(join(candidate, 'reconciliation-candidate.json')).mode & 0o777, 0o600);
    dirs.forEach((dir, index) => assert.deepEqual(readFileSync(join(dir, 'current.json')), before[index]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('staging preserves the base version of conflicts and records every variant for review', () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-reconcile-stage-'));
  const candidate = join(root, 'candidate');
  const archives = [
    { sessions: [row('shared', { total_tokens: 100 }), row('base-only')] },
    { sessions: [row('shared', { total_tokens: 50 }), row('incoming-only')] },
  ];
  const before = structuredClone(archives);
  try {
    const result = stageSessionReconciliation(archives, { dir: candidate, now: new Date('2026-10-03T00:00:00Z') });
    assert.equal(result.status, 'review-required');
    assert.equal(result.candidateSessions, 3);
    assert.equal(result.unresolvedIdentities, 1);
    assert.equal(result.selectedBaseConflictIdentities, 1);
    const staged = readSessionHistorySnapshot({ dir: candidate });
    assert.equal(staged.sessions.find((session) => session.session_id === 'shared').total_tokens, 100);
    assert.ok(staged.sessions.some((session) => session.session_id === 'incoming-only'));
    const sidecar = JSON.parse(readFileSync(join(candidate, 'reconciliation-conflicts.json'), 'utf8'));
    assert.equal(sidecar.status, 'review-required');
    assert.deepEqual(sidecar.conflicts[0].variants.map((item) => item.session.total_tokens), [100, 50]);
    assert.equal(statSync(join(candidate, 'reconciliation-conflicts.json')).mode & 0o777, 0o600);
    assert.deepEqual(archives, before, 'staging leaves source archive snapshots unchanged');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('staging omits conflicts without a base value and refuses incomplete or existing targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'meow-reconcile-incomplete-'));
  try {
    const conflictingIncoming = planSessionReconciliation([
      { sessions: [row('base')] },
      { sessions: [row('unresolved', { total_tokens: 10 })] },
      { sessions: [row('unresolved', { total_tokens: 20 })] },
    ]);
    const result = stageSessionReconciliation([
      { sessions: [row('base')] },
      { sessions: [row('unresolved', { total_tokens: 10 })] },
      { sessions: [row('unresolved', { total_tokens: 20 })] },
    ], { dir: join(root, 'candidate') });
    assert.equal(conflictingIncoming.conflicts.length, 1);
    assert.equal(result.candidateSessions, 1);
    assert.equal(result.omittedConflictsWithoutBase, 1);
    assert.throws(() => stageSessionReconciliation([{ sessions: [] }, { sessions: [], incompleteTailBytes: 1 }], { dir: join(root, 'incomplete') }), /complete archive/);
    assert.throws(() => stageSessionReconciliation([{ sessions: [] }, { sessions: [] }], { dir: join(root, 'candidate') }), /new, unused/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
