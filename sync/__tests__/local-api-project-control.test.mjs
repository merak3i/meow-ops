import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { registerProject } from '../project-control.mjs';
import { upsertLearningTopic } from '../learning-quest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 7451;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADERS = { Origin: BASE, 'x-meow-ops-local': '1' };

let server;
let temp;
let project;
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
  const sessionsFile = join(temp, 'sessions.json');
  mkdirSync(join(projectRoot, '.meow', 'learning-state'), { recursive: true });
  writeFileSync(join(projectRoot, '.meow', 'learning-state', 'INDEX.md'), '# Project learning\n');
  writeFileSync(sessionsFile, JSON.stringify([
    { session_id: 'codex-1', source: 'codex', project: 'Meow Ops', started_at: '2026-07-19T00:00:00.000Z' },
  ]));

  previousControl = process.env.MEOW_PROJECT_CONTROL_DIR;
  previousQuest = process.env.MEOW_LEARNING_QUEST_DIR;
  process.env.MEOW_PROJECT_CONTROL_DIR = controlDir;
  process.env.MEOW_LEARNING_QUEST_DIR = join(temp, 'learning-quest');
  project = registerProject({ name: 'Meow Ops', root: projectRoot, aliases: ['meow-ops'] });
  upsertLearningTopic({
    topic_id: 'structured-output', title: 'Structured output',
    summary: 'Validate an agent response against a schema', lane: 'code',
    approved_for_projection: true, source_project_id: project.project_id,
  });

  server = spawn('node', [join(ROOT, 'sync', 'local-api.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      MEOW_LOCAL_API_PORT: String(PORT),
      MEOW_PROJECT_CONTROL_DIR: controlDir,
      MEOW_LEARNING_QUEST_DIR: process.env.MEOW_LEARNING_QUEST_DIR,
      MEOW_PROJECT_INTELLIGENCE_DIR: join(temp, 'intelligence'),
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

test('hosted UI receives only the safe quest projection, never private project records', async () => {
  const hostedHeaders = { Origin: 'https://meow-ops.vercel.app', 'x-meow-ops-local': '1' };
  const privateResponse = await fetch(`${BASE}/projects`, { headers: hostedHeaders });
  assert.equal(privateResponse.status, 403);

  const questResponse = await fetch(`${BASE}/learning-quest/snapshot`, { headers: hostedHeaders });
  assert.equal(questResponse.status, 200);
  const body = await questResponse.json();
  assert.equal(body.topics[0].topic_id, 'structured-output');
  assert.doesNotMatch(JSON.stringify(body), /source_project|project_id|learning-state|\.meow|path|evidence|metadata/i);
});

test('quest writes require one-use owner nonces and return only recomputed snapshots', async () => {
  const eventNonce = await nonce();
  const recorded = await post('/learning-quest/events', {
    nonce: eventNonce, topic_id: 'structured-output', action: 'lesson_opened', result: 'completed',
  });
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.topics[0].progress.action_count, 1);
  assert.equal(recorded.body.event, undefined);

  const replay = await post('/learning-quest/events', {
    nonce: eventNonce, topic_id: 'structured-output', action: 'lesson_opened', result: 'completed',
  });
  assert.equal(replay.status, 403);
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
