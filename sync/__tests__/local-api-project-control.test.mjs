import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { registerProject } from '../project-control.mjs';
import { appendAgentEvents } from '../project-evidence.mjs';
import { appendLearningEvent, upsertLearningTopic } from '../learning-quest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 7451;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADERS = { Origin: BASE, 'x-meow-ops-local': '1' };

let server;
let temp;
let project;
let lcwiProject;
let previousControl;
let previousQuest;
let serverOutput = '';

async function get(path) {
  const response = await fetch(`${BASE}${path}`, { headers: HEADERS });
  return { status: response.status, body: await response.json() };
}

async function nonce() {
  const response = await get('/loop-eng/nonce');
  return response.body.nonce;
}

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  temp = mkdtempSync(join(tmpdir(), 'meow-project-api-'));
  const controlDir = join(temp, 'control');
  const projectRoot = join(temp, 'project');
  const lcwiRoot = join(temp, 'oneclickwebsite');
  const sessionsFile = join(temp, 'sessions.json');
  mkdirSync(join(projectRoot, '.meow', 'learning-state'), { recursive: true });
  mkdirSync(lcwiRoot, { recursive: true });
  writeFileSync(join(projectRoot, '.meow', 'learning-state', 'INDEX.md'), '# Project learning\n');
  writeFileSync(sessionsFile, JSON.stringify([
    { session_id: 'codex-1', source: 'codex', project: 'Meow Ops', started_at: '2026-07-19T00:00:00.000Z' },
  ]));

  previousControl = process.env.MEOW_PROJECT_CONTROL_DIR;
  previousQuest = process.env.MEOW_LEARNING_QUEST_DIR;
  process.env.MEOW_PROJECT_CONTROL_DIR = controlDir;
  process.env.MEOW_LEARNING_QUEST_DIR = join(temp, 'learning-quest');
  project = registerProject({ name: 'Meow Ops', root: projectRoot, aliases: ['meow-ops'] });
  execFileSync('git', ['init', '-q', lcwiRoot]);
  execFileSync('git', ['-C', lcwiRoot, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', lcwiRoot, 'config', 'user.name', 'Test']);
  writeFileSync(join(lcwiRoot, 'release.txt'), 'release\n');
  execFileSync('git', ['-C', lcwiRoot, 'add', 'release.txt']);
  execFileSync('git', ['-C', lcwiRoot, 'commit', '-qm', 'feat(admin): add audited site operations'], {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
      GIT_COMMITTER_DATE: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
    },
  });
  lcwiProject = registerProject({
    name: 'One Click Website India',
    root: lcwiRoot,
    aliases: ['1CWI', 'LCWI', 'oneclickwebsite'],
    git_remote: 'https://github.com/merak3i/oneclickwebsite.git',
  });
  appendAgentEvents([{
    source: 'codex',
    project_id: lcwiProject.project_id,
    session_id: 'lcwi-session',
    timestamp: new Date(Date.now() - 12 * 60 * 60 * 1_000).toISOString(),
    event_type: 'session_summary',
    content: 'Validated the customer release path.',
    raw_ref: 'codex:lcwi-session',
    sensitivity: 'private',
  }], { dir: join(temp, 'evidence') });
  upsertLearningTopic({
    topic_id: 'structured-output', title: 'Structured output',
    summary: 'Validate an agent response against a schema', lane: 'code',
    approved_for_projection: true, source_project_id: project.project_id,
  });
  upsertLearningTopic({
    topic_id: 'proof-boundary', title: 'Proof boundary',
    summary: 'Only trusted verification can claim a shipment', lane: 'code',
    approved_for_projection: true, source_project_id: project.project_id,
  });
  for (const action of [
    'lesson_opened', 'concept_preview_completed', 'exercise_attempted', 'code_changed',
    'tests_passed', 'broken_case_repaired',
  ]) appendLearningEvent({ topic_id: 'proof-boundary', action, result: 'passed' });
  appendLearningEvent({
    topic_id: 'proof-boundary', action: 'feynman_passed', result: 'passed',
    rubric: { accuracy: 1, clarity: 1, causality: 1, transfer: 1 },
  });
  upsertLearningTopic({
    topic_id: 'marketing-proof', title: 'Marketing proof',
    summary: 'Explain a real capability with verified support', lane: 'marketing',
    approved_for_projection: true,
  });
  for (const action of [
    'lesson_opened', 'concept_preview_completed', 'story_drafted', 'claim_evidence_checked',
    'audience_tested', 'broken_case_repaired',
  ]) appendLearningEvent({ topic_id: 'marketing-proof', action, result: 'passed' });
  appendLearningEvent({
    topic_id: 'marketing-proof', action: 'feynman_passed', result: 'passed',
    rubric: { accuracy: 1, clarity: 1, causality: 1, transfer: 1 },
  });

  server = spawn('node', [join(ROOT, 'sync', 'local-api.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      MEOW_LOCAL_API_PORT: String(PORT),
      MEOW_PROJECT_CONTROL_DIR: controlDir,
      MEOW_LEARNING_QUEST_DIR: process.env.MEOW_LEARNING_QUEST_DIR,
      MEOW_PROJECT_INTELLIGENCE_DIR: join(temp, 'intelligence'),
      MEOW_EVIDENCE_DIR: join(temp, 'evidence'),
      MEOW_LOOP_DIR: join(temp, 'loops'),
      MEOW_SESSION_HISTORY_DIR: join(temp, 'history'),
      MEOW_SESSIONS_FILE: sessionsFile,
    },
    stdio: 'pipe',
  });
  server.stdout.on('data', (chunk) => { serverOutput += chunk; });
  server.stderr.on('data', (chunk) => { serverOutput += chunk; });
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await get('/projects');
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`project-control API did not start: ${serverOutput}`);
});

after(() => {
  server?.kill();
  if (previousControl === undefined) delete process.env.MEOW_PROJECT_CONTROL_DIR;
  else process.env.MEOW_PROJECT_CONTROL_DIR = previousControl;
  if (previousQuest === undefined) delete process.env.MEOW_LEARNING_QUEST_DIR;
  else process.env.MEOW_LEARNING_QUEST_DIR = previousQuest;
  rmSync(temp, { recursive: true, force: true });
});

test('project routes expose an Eagle Eye snapshot and learning state', async () => {
  const portfolio = await get('/projects');
  assert.equal(portfolio.status, 200);
  assert.equal(portfolio.body.projects[0].project.project_id, project.project_id);
  assert.deepEqual(portfolio.body.projects[0].agents.observed, ['codex']);

  const state = await get(`/projects/${project.project_id}/learning-state`);
  assert.equal(state.status, 200);
  assert.match(state.body.files['INDEX.md'], /Project learning/);
});

test('website project registration is local-only, nonce-bound, and validates the folder', async () => {
  const root = join(temp, 'registered-from-dashboard');
  mkdirSync(root);
  const registrationNonce = await nonce();
  const registered = await post('/projects', {
    nonce: registrationNonce,
    name: 'Dashboard Project',
    aliases: ['dashboard', 'dashboard-project'],
    root,
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.project.name, 'Dashboard Project');
  assert.equal(registered.body.project.root, root);
  assert.deepEqual(registered.body.project.aliases, ['dashboard', 'dashboard-project']);

  const replay = await post('/projects', {
    nonce: registrationNonce,
    name: 'Replay Project',
    root,
  });
  assert.equal(replay.status, 403);

  const missing = await post('/projects', {
    nonce: await nonce(),
    name: 'Missing Folder',
    root: join(temp, 'does-not-exist'),
  });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /existing absolute local directory/);

  const hostedHeaders = {
    Origin: 'https://meow-ops.vercel.app',
    'x-meow-ops-local': '1',
    'Content-Type': 'application/json',
  };
  const hosted = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: hostedHeaders,
    body: JSON.stringify({ nonce: await nonce(), name: 'Hosted', root }),
  });
  assert.equal(hosted.status, 403);
});

test('Companion answers a bounded LCWI feature question from local project evidence', async () => {
  const result = await post('/loop-eng/ask', {
    question: 'what happened in lcwi project in the last 3 days? what features were worked on according to the github pr on merak3i',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.gate, 'known_known');
  assert.match(result.body.answer, /One Click Website India/);
  assert.match(result.body.answer, /add audited site operations/);
  assert.match(result.body.answer, /local Git history/i);
  assert.ok(result.body.evidence.some((item) => item.kind === 'git_commit'));
  assert.ok(result.body.evidence.some((item) => item.kind === 'project_evidence'));
});

test('Companion keeps short LCWI change variants project-scoped', async () => {
  for (const question of [
    'recent activity in lcwi project',
    'what changed in lcwi?',
    'what happened in lcwi?',
    'what features were worked on in lcwi?',
  ]) {
    const result = await post('/loop-eng/ask', { question });
    assert.equal(result.status, 200);
    assert.equal(result.body.gate, 'known_known');
    assert.match(result.body.answer, /One Click Website India/);
    assert.match(result.body.answer, /add audited site operations/);
    assert.doesNotMatch(result.body.answer, /No recent decisions|Meow Ops has/i);
  }
});

test('Vite fallback ports on localhost can read the project catalog', async () => {
  for (const origin of ['http://localhost:5174', 'http://localhost:5175', 'http://127.0.0.1:5174']) {
    const response = await fetch(`${BASE}/projects`, {
      headers: { Origin: origin, 'x-meow-ops-local': '1' },
    });
    assert.equal(response.status, 200, origin);
    const body = await response.json();
    assert.equal(body.ok, true, origin);
    assert.ok(Array.isArray(body.projects), origin);
  }
});

test('hosted UI receives only the safe quest projection, never private project records', async () => {
  const hostedHeaders = { Origin: 'https://meow-ops.vercel.app', 'x-meow-ops-local': '1' };
  const privateResponse = await fetch(`${BASE}/projects`, { headers: hostedHeaders });
  assert.equal(privateResponse.status, 403);

  const questResponse = await fetch(`${BASE}/learning-quest/snapshot`, { headers: hostedHeaders });
  assert.equal(questResponse.status, 200);
  const body = await questResponse.json();
  assert.ok(body.topics.some((topic) => topic.topic_id === 'structured-output'));
  assert.doesNotMatch(
    JSON.stringify(body),
    /source_project|project_id|learning-state|\.meow|proof_fingerprint|raw_ref|outcome_kind|private evidence note/i,
  );
});

test('quest writes require one-use owner nonces and return only recomputed snapshots', async () => {
  const workshopNonce = await nonce();
  const started = await post('/learning-quest/workshop', {
    nonce: workshopNonce, action: 'start', topic_ids: ['structured-output'],
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.workshop.state, 'active');

  const eventNonce = await nonce();
  const recorded = await post('/learning-quest/events', {
    nonce: eventNonce, topic_id: 'structured-output', action: 'lesson_opened', result: 'completed',
  });
  assert.equal(recorded.status, 200);
  assert.equal(
    recorded.body.topics.find((topic) => topic.topic_id === 'structured-output').progress.action_count,
    1,
  );
  assert.equal(recorded.body.event, undefined);

  const replay = await post('/learning-quest/events', {
    nonce: eventNonce, topic_id: 'structured-output', action: 'lesson_opened', result: 'completed',
  });
  assert.equal(replay.status, 403);

  const finishNonce = await nonce();
  const finished = await post('/learning-quest/workshop', { nonce: finishNonce, action: 'complete' });
  assert.equal(finished.status, 200);
  assert.equal(finished.body.workshop.state, 'none');
});

test('generic learning events cannot forge shipped proof', async () => {
  const forged = await post('/learning-quest/events', {
    nonce: await nonce(),
    topic_id: 'proof-boundary',
    action: 'pr_verified',
    result: 'passed',
    proof_fingerprint: 'sha256:caller-supplied',
  });
  assert.equal(forged.status, 400);
  assert.match(forged.body.error, /verifier-owned/);
});

test('owner-confirmed non-code outcome uses a nonce-bound proof path', async () => {
  const result = await post('/learning-quest/outcome-proof', {
    nonce: await nonce(),
    topic_id: 'marketing-proof',
    outcome_kind: 'published_marketing_asset',
    note: 'I opened the published asset and verified that every visible claim has supporting evidence.',
    confirmed: true,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.topics.find((topic) => topic.topic_id === 'marketing-proof').stage, 'shipped');
  assert.doesNotMatch(JSON.stringify(result.body), /published asset|proof_fingerprint|outcome_kind/i);
});

test('active learning topics are protected until the workshop is abandoned', async () => {
  const started = await post('/learning-quest/workshop', {
    nonce: await nonce(), action: 'start', topic_ids: ['proof-boundary'],
  });
  assert.equal(started.status, 200);
  const blocked = await post('/learning-quest/topics/delete', {
    nonce: await nonce(), topic_id: 'proof-boundary',
  });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /active workshop/);
  const abandoned = await post('/learning-quest/workshop', { nonce: await nonce(), action: 'abandon' });
  assert.equal(abandoned.status, 200);
  assert.equal(abandoned.body.workshop.state, 'none');
});

test('learning proposal and decision routes enforce one-use owner nonces', async () => {
  const proposalNonce = await nonce();
  const proposed = await post(`/projects/${project.project_id}/learnings`, {
    nonce: proposalNonce,
    kind: 'practice',
    title: 'Read evidence first',
    proposed_content: 'Inspect local evidence before making a claim.',
    rationale: 'Prevents unsupported recommendations.',
    evidence: [{ kind: 'session', ref: 'codex-1' }],
    impact: 'high',
    confidence: 1,
  });
  assert.equal(proposed.status, 201);
  assert.equal(proposed.body.learning.status, 'proposed');

  const replay = await post(`/projects/${project.project_id}/learnings`, {
    nonce: proposalNonce,
    kind: 'practice', title: 'Replay', proposed_content: 'Replay',
    rationale: 'Replay', evidence: [{ kind: 'session', ref: 'codex-1' }],
    impact: 'low', confidence: 1,
  });
  assert.equal(replay.status, 403);

  const decided = await post(
    `/projects/${project.project_id}/learnings/${proposed.body.learning.learning_id}/decision`,
    { nonce: await nonce(), decision: 'approved', reason: 'Owner-approved project practice.' },
  );
  assert.equal(decided.status, 200);
  assert.equal(decided.body.learning.status, 'published');
});

test('an interrupted learning publication can be retried without losing owner approval', async () => {
  const blockedRoot = join(temp, 'blocked-publication-project');
  mkdirSync(blockedRoot);
  writeFileSync(join(blockedRoot, '.meow'), 'temporarily blocked by a file', 'utf8');
  const blockedProject = registerProject({ name: 'Blocked Publication', root: blockedRoot });
  const proposed = await post(`/projects/${blockedProject.project_id}/learnings`, {
    nonce: await nonce(),
    kind: 'practice',
    title: 'Retry interrupted publication',
    proposed_content: 'Retry the same owner-approved publication after the local path is repaired.',
    rationale: 'A transient write failure must not strand approved learning.',
    evidence: [{ kind: 'test', ref: 'retry-publication' }],
    impact: 'high',
    confidence: 1,
  });
  assert.equal(proposed.status, 201);

  const firstAttempt = await post(
    `/projects/${blockedProject.project_id}/learnings/${proposed.body.learning.learning_id}/decision`,
    { nonce: await nonce(), decision: 'approved', reason: 'Owner approved this practice.' },
  );
  assert.equal(firstAttempt.status, 400);

  rmSync(join(blockedRoot, '.meow'));
  const retry = await post(
    `/projects/${blockedProject.project_id}/learnings/${proposed.body.learning.learning_id}/decision`,
    { nonce: await nonce(), decision: 'approved', reason: 'Retry approved publication.' },
  );
  assert.equal(retry.status, 200);
  assert.equal(retry.body.learning.status, 'published');
});

test('adapter preview is read-only and includes every target agent', async () => {
  const preview = await post(`/projects/${project.project_id}/adapters/preview`, {});
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.preview.targets.map((target) => target.agent), [
    'codex', 'claude', 'cursor', 'antigravity', 'hermes',
  ]);
});

test('adapter apply and rollback require owner nonces and preserve backups', async () => {
  const preview = await post(`/projects/${project.project_id}/adapters/preview`, {});
  const expected_checksums = Object.fromEntries(
    preview.body.preview.targets.map((target) => [target.agent, target.checksum]),
  );
  const applied = await post(`/projects/${project.project_id}/adapters/apply`, {
    nonce: await nonce(), expected_checksums,
  });
  assert.equal(applied.status, 200);
  assert.equal(existsSync(join(project.root, 'CLAUDE.md')), true);
  assert.match(readFileSync(join(project.root, 'CLAUDE.md'), 'utf8'), /@\.meow\/learning-state\/INDEX\.md/);

  const rolledBack = await post(`/projects/${project.project_id}/adapters/rollback`, {
    nonce: await nonce(), sync_id: applied.body.result.sync_id,
  });
  assert.equal(rolledBack.status, 200);
  assert.equal(existsSync(join(project.root, 'CLAUDE.md')), false);
});
