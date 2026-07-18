import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendLearningCandidate,
  applyProjectAdapters,
  buildProjectControlSnapshot,
  decideLearningCandidate,
  previewProjectAdapters,
  publishLearningCandidate,
  readLearningCandidates,
  readProjectCatalog,
  registerProject,
  rollbackProjectAdapters,
} from '../project-control.mjs';

function withProjectControl(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-project-control-'));
  const previous = process.env.MEOW_PROJECT_CONTROL_DIR;
  process.env.MEOW_PROJECT_CONTROL_DIR = join(dir, 'private');
  try {
    return fn(dir);
  } finally {
    if (previous === undefined) delete process.env.MEOW_PROJECT_CONTROL_DIR;
    else process.env.MEOW_PROJECT_CONTROL_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('project catalog keeps a stable identity and merges aliases', () => withProjectControl((dir) => {
  const root = join(dir, 'meow-ops');
  mkdirSync(root);
  const first = registerProject({
    name: 'Meow Ops', root, git_remote: 'git@github.com:merak3i/meow-ops.git',
    aliases: ['meow-ops'],
  });
  const second = registerProject({
    name: 'Meow Ops', root, git_remote: 'git@github.com:merak3i/meow-ops.git',
    aliases: ['Meow Operations'],
  });

  assert.equal(first.project_id, second.project_id);
  assert.match(first.project_id, /^meow-ops-[a-f0-9]{10}$/);
  const [stored] = readProjectCatalog();
  assert.deepEqual(stored.aliases, ['Meow Operations', 'meow-ops']);
  assert.equal(stored.learning_state_path, join(root, '.meow', 'learning-state'));
}));

test('learning is review-only until an owner decision approves it', () => withProjectControl((dir) => {
  const project = registerProject({ name: 'Meow Ops', root: join(dir, 'meow-ops') });
  const candidate = appendLearningCandidate({
    project_id: project.project_id,
    kind: 'practice',
    title: 'Read project learning before planning',
    proposed_content: 'Read .meow/learning-state/INDEX.md before planning project work.',
    rationale: 'Keeps native agents aligned with owner-approved project intent.',
    evidence: [{ kind: 'owner_instruction', ref: 'goal-plan' }],
    impact: 'high',
    confidence: 1,
  });

  assert.equal(candidate.status, 'proposed');
  const approved = decideLearningCandidate(candidate.learning_id, {
    decision: 'approved', decided_by: 'owner', reason: 'Matches the project-control goal.',
  });
  assert.equal(approved.status, 'approved');
  assert.equal(readLearningCandidates().length, 1);
  assert.equal(readLearningCandidates()[0].decision.reason, 'Matches the project-control goal.');
}));

test('control snapshot exposes constitution, agent coverage, and learning queue', () => withProjectControl((dir) => {
  const project = registerProject({ name: 'Meow Ops', root: join(dir, 'meow-ops') });
  appendLearningCandidate({
    project_id: project.project_id,
    kind: 'skill', title: 'Project evidence review', proposed_content: 'Review evidence.',
    rationale: 'Prevents unsupported claims.', evidence: [{ kind: 'session', ref: 's-1' }],
    impact: 'medium', confidence: 0.8,
  });
  const snapshot = buildProjectControlSnapshot({
    project_id: project.project_id,
    sessions: [
      { source: 'codex', project: 'Meow Ops', session_id: 's-1' },
      { source: 'claude', project: 'Meow Ops', session_id: 's-2' },
    ],
    claims: [
      { project_id: project.project_id, field: 'mission', value: 'Make agent work legible.', status: 'owner_confirmed' },
      { project_id: project.project_id, field: 'constraint', value: 'Local first.', status: 'owner_confirmed' },
    ],
  });

  assert.equal(snapshot.project.project_id, project.project_id);
  assert.equal(snapshot.constitution.coverage.confirmed, 2);
  assert.deepEqual(snapshot.agents.observed, ['claude', 'codex']);
  assert.deepEqual(snapshot.agents.blind_spots, ['antigravity', 'cursor', 'hermes']);
  assert.equal(snapshot.learning.counts.proposed, 1);
}));

test('adapter preview preserves existing instructions and targets all five agents', () => withProjectControl((dir) => {
  const root = join(dir, 'project');
  mkdirSync(join(root, '.hermes'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), '# Existing Codex rules\n', 'utf8');
  writeFileSync(join(root, '.hermes', 'HERMES.md'), '# Existing Hermes rules\n', 'utf8');

  const preview = previewProjectAdapters({ projectRoot: root });
  assert.deepEqual(preview.targets.map((target) => target.agent), [
    'codex', 'claude', 'cursor', 'antigravity', 'hermes',
  ]);
  assert.match(preview.targets[0].content, /Existing Codex rules/);
  assert.match(preview.targets[0].content, /\.meow\/learning-state\/INDEX\.md/);
  assert.match(preview.targets[1].content, /@\.meow\/learning-state\/INDEX\.md/);
  assert.match(preview.targets[2].path, /\.cursor\/rules\/meow-learning-state\.mdc$/);
  assert.match(preview.targets[3].path, /\.agents\/rules\/meow-learning-state\.md$/);
  assert.equal(preview.targets[4].path, join(root, '.hermes', 'HERMES.md'));
  assert.match(preview.targets[4].content, /Existing Hermes rules/);
  assert.equal(existsSync(join(root, 'CLAUDE.md')), false, 'preview must not write');
  assert.ok(preview.targets.every((target) => /^[a-f0-9]{64}$/.test(target.checksum)));
}));

test('adapter apply requires the exact preview and rollback restores prior files', () => withProjectControl((dir) => {
  const root = join(dir, 'project');
  mkdirSync(join(root, '.meow', 'learning-state'), { recursive: true });
  writeFileSync(join(root, '.meow', 'learning-state', 'INDEX.md'), '# Approved learning\n', 'utf8');
  writeFileSync(join(root, 'AGENTS.md'), '# Existing rules\n', 'utf8');
  const preview = previewProjectAdapters({ projectRoot: root });
  const applied = applyProjectAdapters({
    projectRoot: root,
    expectedChecksums: Object.fromEntries(preview.targets.map((target) => [target.agent, target.checksum])),
  });

  assert.equal(applied.applied.length, 5);
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /Existing rules/);
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /@\.meow\/learning-state\/INDEX\.md/);
  assert.equal(existsSync(join(root, '.cursor', 'rules', 'meow-learning-state.mdc')), true);

  const rolledBack = rollbackProjectAdapters(applied.sync_id);
  assert.equal(rolledBack.restored.length, 5);
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# Existing rules\n');
  assert.equal(existsSync(join(root, 'CLAUDE.md')), false);
}));

test('adapter apply rejects a stale preview before writing', () => withProjectControl((dir) => {
  const root = join(dir, 'project');
  mkdirSync(join(root, '.meow', 'learning-state'), { recursive: true });
  writeFileSync(join(root, '.meow', 'learning-state', 'INDEX.md'), '# Approved learning\n', 'utf8');
  const preview = previewProjectAdapters({ projectRoot: root });
  writeFileSync(join(root, 'AGENTS.md'), '# Changed after preview\n', 'utf8');
  assert.throws(() => applyProjectAdapters({
    projectRoot: root,
    expectedChecksums: Object.fromEntries(preview.targets.map((target) => [target.agent, target.checksum])),
  }), /stale preview/);
  assert.equal(existsSync(join(root, 'CLAUDE.md')), false);
}));

test('approved learning publishes into the canonical state and updates its index', () => withProjectControl((dir) => {
  const root = join(dir, 'project');
  mkdirSync(join(root, '.meow', 'learning-state'), { recursive: true });
  writeFileSync(join(root, '.meow', 'learning-state', 'INDEX.md'), '# Project learning\n', 'utf8');
  const project = registerProject({ name: 'Meow Ops', root });
  const candidate = appendLearningCandidate({
    project_id: project.project_id,
    kind: 'practice',
    title: 'Inspect evidence before claims',
    proposed_content: 'Inspect the exact local evidence before making a project claim.',
    rationale: 'Prevents unsupported recommendations.',
    evidence: [{ kind: 'session', ref: 'codex-1' }],
    impact: 'high', confidence: 1,
  });
  decideLearningCandidate(candidate.learning_id, {
    decision: 'approved', reason: 'Owner approved.', decided_by: 'owner',
  });
  const published = publishLearningCandidate(candidate.learning_id);
  assert.equal(published.status, 'published');
  assert.equal(existsSync(published.publication.path), true);
  assert.match(readFileSync(published.publication.path, 'utf8'), /Inspect the exact local evidence/);
  assert.match(readFileSync(join(root, '.meow', 'learning-state', 'INDEX.md'), 'utf8'), /Inspect evidence before claims/);
  assert.equal(publishLearningCandidate(candidate.learning_id).publication.path, published.publication.path);
}));
