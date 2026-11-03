// Swarm run engine against a simulated AutoSwarm. The fake `exec` writes the
// same receipts AutoSwarm writes (calls/<id>/task|handle|result|cancel.json,
// approvals/<id>/request.json) so the real receipt reader drives every state.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { buildPrompt, createOrchestrator, normalizePlan, parsePlanReply, PlanError } from '../swarm-orchestrator.mjs';

let root;
let home;
let ws;
let engine;
let log;

const hex = (n) => randomBytes(n).toString('hex');
const write = (path, value) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };

// A miniature AutoSwarm: a directive at the start of a step's own
// instructions decides the outcome (stitched upstream text cannot trigger it).
function fakeExec({ slowDecisions = 0 } = {}) {
  return async (args) => {
    log.push(args.join(' '));
    const [command] = args;
    if (slowDecisions && (command === 'approve' || command === 'deny')) await new Promise((done) => setTimeout(done, slowDecisions));
    if (command === 'run' || command === 'resume') {
      const id = `call_${hex(16)}`;
      const dir = join(home, 'calls', id);
      const prompt = readFileSync(args[args.indexOf('--input') + 1], 'utf8');
      const provider = command === 'run' ? args[args.indexOf('--agent') + 1] : 'codex';
      write(join(dir, 'task.json'), { call_id: id, provider, prompt, workspace: ws, created_at: new Date().toISOString(), previous_call: command === 'resume' ? args[1] : null, model: args.includes('--model') ? args[args.indexOf('--model') + 1] : null });
      write(join(dir, 'handle.json'), { pid: process.pid, native_session_id: 'sess-1' });
      if (prompt.startsWith('APPROVE-ME')) {
        write(join(dir, 'approvals', `approval_${'a'.repeat(32)}`, 'request.json'), { kind: 'approval_required', created_at: new Date().toISOString(), native_request: { toolCall: { title: 'Run make deploy' } } });
      } else if (prompt.startsWith('ASK-ME')) {
        write(join(dir, 'approvals', `approval_${'b'.repeat(32)}`, 'request.json'), {
          kind: 'interaction_required', response_format: 'claude-question', response_help: '{"answers":{"exact question text":"label or text"}}', user_required: false, created_at: new Date().toISOString(),
          native_request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Which database?', header: 'DB', multiSelect: false, options: [{ label: 'Postgres', description: 'Managed' }, { label: 'SQLite' }] }] } },
        });
      } else if (!prompt.startsWith('HOLD-ME')) {
        const fail = prompt.startsWith('FAIL-ME') && provider !== 'claude-code';
        const reply = prompt.includes('Reply with one JSON object')
          ? `Here is the plan:\n{"title":"Drafted","steps":[{"id":"s1","title":"Build","provider":"codex","instructions":"Build it"},{"id":"s2","title":"Check","kind":"review","provider":"nonexistent","instructions":"Review it","dependsOn":["s1"]}]}\nDone.`
          : `ECHO[${provider}]: ${prompt}`;
        write(join(dir, 'result.json'), fail
          ? { outcome: 'failed', error: 'native exploded', error_code: 'child_failed', content: '', finished_at: new Date().toISOString() }
          : { outcome: 'completed', content: reply, native_session_id: 'sess-1', finished_at: new Date().toISOString() });
      }
      return { ok: true, data: { call_id: id, controller_id: 'main_test', state: 'running' } };
    }
    if (command === 'approve' || command === 'deny') {
      const dir = join(home, 'calls', args[1]);
      write(join(dir, 'approvals', args[2], 'decision.json'), { decision: command });
      write(join(dir, 'result.json'), command === 'approve'
        ? { outcome: 'completed', content: 'approved and done', native_session_id: 'sess-1', finished_at: new Date().toISOString() }
        : { outcome: 'failed', error: 'denied by user', error_code: 'denied', content: '', finished_at: new Date().toISOString() });
      return { ok: true, data: { decision: command } };
    }
    if (command === 'answer') {
      const dir = join(home, 'calls', args[1]);
      const response = JSON.parse(readFileSync(args[args.indexOf('--input') + 1], 'utf8'));
      write(join(dir, 'approvals', args[2], 'decision.json'), { response, actor: args[args.indexOf('--by') + 1] });
      write(join(dir, 'result.json'), { outcome: 'completed', content: `answered ${JSON.stringify(response)}`, native_session_id: 'sess-1', finished_at: new Date().toISOString() });
      return { ok: true, data: { response } };
    }
    if (command === 'cancel') {
      const dir = join(home, 'calls', args[1]);
      write(join(dir, 'cancel.json'), { call_id: args[1] });
      write(join(dir, 'result.json'), { outcome: 'cancelled', content: '', finished_at: new Date().toISOString() });
      return { ok: true, data: { cancelled: true } };
    }
    return { ok: false, error: { code: 'unknown', message: command } };
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'meow-swarm-engine-'));
  home = join(root, 'autoswarm');
  ws = join(root, 'ws');
  mkdirSync(ws, { recursive: true });
  log = [];
  engine = createOrchestrator({ runsDir: join(root, 'runs'), swarmHome: home, home: root, exec: fakeExec(), launcher: { argv: ['autoswarm'], source: 'test' } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function settle(id, rounds = 30) {
  let run = engine.getRun(id);
  for (let i = 0; i < rounds && !['completed', 'needs-attention', 'cancelled'].includes(run.status); i++) {
    await engine.tick();
    run = engine.getRun(id);
  }
  return run;
}

const plan = (steps, extra = {}) => ({ title: 'T', brief: 'Goal', workspace: ws, steps, ...extra });

test('plans are validated with sentences a person can act on', () => {
  assert.throws(() => normalizePlan(plan([]), { home: root }), /at least one step/);
  assert.throws(() => normalizePlan({ ...plan([{ provider: 'codex', instructions: 'x' }]), workspace: join(root, 'missing') }, { home: root }), /does not exist/);
  assert.throws(() => normalizePlan(plan([{ id: 's1', provider: 'codex', instructions: 'x', dependsOn: ['s2'] }, { id: 's2', provider: 'codex', instructions: 'y' }]), { home: root }), /must come earlier/);
  assert.throws(() => normalizePlan(plan([{ id: 's1', provider: 'codex', instructions: 'x' }, { id: 's1', provider: 'codex', instructions: 'y' }]), { home: root }), /used twice/);
  assert.throws(() => normalizePlan(plan([{ provider: 'codex', instructions: 'x', model: 'gpt 5; rm -rf' }]), { home: root }), /native id without spaces/);
  assert.throws(() => normalizePlan(plan([{ provider: 'nope', instructions: 'x' }]), { home: root }), /choose a harness/);
  assert.throws(() => normalizePlan(plan(Array.from({ length: 25 }, (_, i) => ({ provider: 'codex', instructions: `x${i}` }))), { home: root }), /at most 24/);
  const ok = normalizePlan(plan([{ provider: 'deepseek-harness', instructions: 'x', model: 'anthropic/claude-opus-5.5', effort: 'low' }], { workspace: '~/ws' }), { home: root });
  assert.equal(ok.workspace, ws);
  assert.equal(ok.steps[0].provider, 'dsh');
  assert.equal(ok.steps[0].id, 's1');
  assert.equal(ok.maxParallel, 3);
});

test('prompts put your instructions first, then run context and upstream outputs', () => {
  const run = { title: 'R', brief: 'Ship it', workspace: ws, steps: [
    { id: 's1', title: 'A', kind: 'execute', provider: 'codex', model: 'm1', instructions: 'Do A', dependsOn: [], output: 'OUT-A' },
    { id: 's2', title: 'B', kind: 'integrate', provider: 'hermes', instructions: 'Merge', dependsOn: ['s1'], output: null },
  ] };
  const prompt = buildPrompt(run, run.steps[1]);
  assert.ok(prompt.startsWith('Merge\n'));
  assert.match(prompt, /### s1 · A \(Codex · m1\)\nOUT-A/);
  assert.match(prompt, /Combine the inputs below/);
  assert.equal(buildPrompt(run, { ...run.steps[1], raw: true }), 'Merge');
  const long = buildPrompt({ ...run, steps: [{ ...run.steps[0], output: 'x'.repeat(20_000) }, run.steps[1]] }, run.steps[1]);
  assert.match(long, /more characters kept in the AutoSwarm receipt/);
});

test('an agent-drafted plan is found inside a chatty reply and mapped to available harnesses', () => {
  const reply = 'Sure! {"not":"a plan"} and then {"title":"X","steps":[{"title":"Build","provider":"grok","instructions":"b"},{"title":"Review","kind":"review","provider":"claude","instructions":"r","dependsOn":["s1"]}]} thanks';
  const parsed = parsePlanReply(reply, { title: 'Base', brief: 'g', workspace: ws }, { home: root, fallbackProviders: ['codex', 'claude-code'] });
  assert.equal(parsed.title, 'X');
  assert.deepEqual(parsed.steps.map((step) => step.provider), ['codex', 'claude-code']);
  assert.deepEqual(parsed.steps[1].dependsOn, ['s1']);
  assert.equal(parsePlanReply('no json here', { title: 'B', brief: 'g', workspace: ws }, { home: root }), null);
});

test('fan-out runs in parallel and the integrate step receives every output', async () => {
  const draft = engine.saveDraft(plan([
    { id: 'a', provider: 'codex', instructions: 'TOKEN-A' },
    { id: 'b', provider: 'claude-code', instructions: 'TOKEN-B' },
    { id: 'c', provider: 'cursor', instructions: 'TOKEN-C' },
    { id: 'join', kind: 'integrate', provider: 'hermes', instructions: 'Merge', dependsOn: ['a', 'b', 'c'] },
  ]));
  assert.equal(draft.status, 'draft');
  const started = await engine.dispatch(draft.id);
  assert.deepEqual(started.steps.map((step) => step.status), ['running', 'running', 'running', 'queued']);
  const done = await settle(draft.id);
  assert.equal(done.status, 'completed');
  const merged = done.steps[3].output;
  for (const token of ['TOKEN-A', 'TOKEN-B', 'TOKEN-C']) assert.ok(merged.includes(token), token);
  assert.ok(log.every((line) => !/--name|--allow-peer|--communication-rules/.test(line)), 'a plain run passes no messaging flags');
  assert.equal(done.controllerId, 'main_test');
});

test('max parallel is honoured', async () => {
  const draft = engine.saveDraft(plan(['a', 'b', 'c', 'd'].map((id) => ({ id, provider: 'codex', instructions: `HOLD-ME ${id}` })), { maxParallel: 2 }));
  const run = await engine.dispatch(draft.id);
  assert.equal(run.steps.filter((step) => step.status === 'running').length, 2);
  await engine.tick();
  assert.equal(engine.getRun(draft.id).steps.filter((step) => step.status === 'running').length, 2);
  await engine.cancelRun(draft.id);
  assert.equal((await settle(draft.id)).status, 'cancelled');
});

test('a failure blocks its branch until you retry it on another harness', async () => {
  const draft = engine.saveDraft(plan([
    { id: 'a', provider: 'codex', instructions: 'FAIL-ME please' },
    { id: 'b', provider: 'cursor', instructions: 'Use A', dependsOn: ['a'] },
  ]));
  await engine.dispatch(draft.id);
  let run = await settle(draft.id);
  assert.equal(run.status, 'needs-attention');
  assert.deepEqual(run.steps.map((step) => step.status), ['failed', 'blocked']);
  assert.equal(run.steps[0].errorCode, 'child_failed');
  assert.equal(run.steps[0].error, 'native exploded');
  await assert.rejects(engine.retryStep(draft.id, 'b'), PlanError);
  await engine.retryStep(draft.id, 'a', { provider: 'claude-code', model: 'opus' });
  run = await settle(draft.id);
  assert.equal(run.status, 'completed');
  assert.equal(run.steps[0].provider, 'claude-code');
  assert.equal(run.steps[0].attempts.length, 2);
  assert.ok(log.some((line) => line.startsWith('run --agent claude-code') && line.includes('--model opus')));
});

test('approvals wait for your decision and relay it with --by user', async () => {
  const draft = engine.saveDraft(plan([{ id: 'a', provider: 'hermes', instructions: 'APPROVE-ME' }, { id: 'b', provider: 'codex', instructions: 'APPROVE-ME too' }]));
  await engine.dispatch(draft.id);
  await engine.tick();
  let run = engine.getRun(draft.id);
  assert.deepEqual(run.steps.map((step) => step.status), ['waiting', 'waiting']);
  assert.equal(run.steps[0].pending[0].title, 'Run make deploy');
  await assert.rejects(engine.decide(draft.id, 'a', `approval_${'b'.repeat(32)}`, true), /no longer pending/);
  await engine.decide(draft.id, 'a', `approval_${'a'.repeat(32)}`, true);
  await engine.decide(draft.id, 'b', `approval_${'a'.repeat(32)}`, false);
  run = await settle(draft.id);
  assert.deepEqual(run.steps.map((step) => step.status), ['completed', 'failed']);
  assert.ok(log.some((line) => /^approve call_\w+ approval_a+ --by user$/.test(line)));
  assert.ok(log.some((line) => /^deny call_\w+ approval_a+ --by user$/.test(line)));
});

test('a finished step can be resumed with a follow-up in the same native session', async () => {
  const draft = engine.saveDraft(plan([{ id: 'a', provider: 'codex', instructions: 'First pass' }]));
  await engine.dispatch(draft.id);
  let run = await settle(draft.id);
  const firstCall = run.steps[0].callId;
  await engine.followUp(draft.id, 'a', 'Now tighten it');
  run = await settle(draft.id);
  assert.equal(run.status, 'completed');
  assert.notEqual(run.steps[0].callId, firstCall);
  assert.match(run.steps[0].output, /Now tighten it/);
  assert.deepEqual(run.steps[0].attempts.map((attempt) => attempt.kind), ['run', 'follow-up']);
  assert.ok(log.some((line) => line.startsWith(`resume ${firstCall} --input`)));
});

test('drafts stay editable, dispatched runs do not, and no launcher means no dispatch', async () => {
  const draft = engine.saveDraft(plan([{ provider: 'codex', instructions: 'x' }]));
  const edited = engine.saveDraft(plan([{ provider: 'cursor', instructions: 'y' }]), { id: draft.id });
  assert.equal(edited.id, draft.id);
  assert.equal(edited.steps[0].provider, 'cursor');
  await engine.dispatch(draft.id);
  await assert.rejects(engine.dispatch(draft.id), /already dispatched/);
  assert.throws(() => engine.saveDraft(plan([{ provider: 'codex', instructions: 'z' }]), { id: draft.id }), /Only a draft/);
  const offline = createOrchestrator({ runsDir: join(root, 'runs2'), swarmHome: home, home: root, exec: fakeExec(), launcher: { argv: null, source: null, error: 'AutoSwarm is not installed where the helper can run it.' } });
  const other = offline.saveDraft(plan([{ provider: 'codex', instructions: 'x' }]));
  await assert.rejects(offline.dispatch(other.id), /not installed/);
  assert.equal(offline.capabilities().dispatch, false);
});

test('an agent can draft the breakdown, which comes back as an editable plan', async () => {
  const run = await engine.draftPlan({ brief: 'Build and review a CLI', workspace: ws, provider: 'codex', providers: [{ id: 'codex', label: 'Codex' }, { id: 'claude-code', label: 'Claude Code' }] });
  const done = await settle(run.id);
  assert.equal(done.purpose, 'plan');
  assert.equal(done.status, 'completed');
  assert.equal(done.proposal.title, 'Drafted');
  assert.deepEqual(done.proposal.steps.map((step) => step.provider), ['codex', 'codex']);
  assert.equal(done.proposal.steps[1].kind, 'review');
  assert.ok(existsSync(join(root, 'runs', run.id, 'prompts', 'plan-1.md')));
});

test('run files stay private and listings summarise them', async () => {
  const draft = engine.saveDraft(plan([{ provider: 'codex', instructions: 'x' }], { tags: ['qa'] }));
  await engine.dispatch(draft.id);
  await settle(draft.id);
  const [summary] = engine.listRuns();
  assert.equal(summary.id, draft.id);
  assert.equal(summary.status, 'completed');
  assert.deepEqual(summary.providers, ['codex']);
  assert.deepEqual(summary.tags, ['qa']);
  assert.throws(() => engine.getRun('../../etc'), /Unknown run/);
});

test('a native question surfaces with its options and is answered, not approved', async () => {
  const draft = engine.saveDraft({ title: 'Ask', workspace: ws, steps: [{ id: 's1', provider: 'claude-code', raw: true, instructions: 'ASK-ME which database' }] });
  await engine.dispatch(draft.id);
  await engine.tick();
  let run = engine.getRun(draft.id);
  const step = run.steps[0];
  assert.equal(step.status, 'waiting');
  const [pending] = step.pending;
  assert.equal(pending.kind, 'question');
  assert.equal(pending.question.format, 'claude-question');
  assert.deepEqual(pending.question.questions, [{ key: 'Which database?', text: 'Which database?', multi: false, options: [{ id: 'Postgres', label: 'Postgres', description: 'Managed' }, { id: 'SQLite', label: 'SQLite' }] }]);
  await assert.rejects(engine.decide(run.id, 's1', pending.requestId, true), /question, not a permission/);
  await assert.rejects(engine.answer(run.id, 's1', pending.requestId, ['Postgres']), /JSON object/);
  run = await engine.answer(run.id, 's1', pending.requestId, { answers: { 'Which database?': 'Postgres' } });
  assert.equal(run.steps[0].pending.length, 0);
  assert.ok(log.some((line) => line.startsWith(`answer ${step.callId} ${pending.requestId} --input `) && line.endsWith('--by user')));
  run = await settle(run.id);
  assert.equal(run.status, 'completed');
  assert.match(run.steps[0].output, /"Which database\?":"Postgres"/);
  await assert.rejects(engine.answer(run.id, 's1', pending.requestId, { answers: {} }), /no longer pending/);
});

test('two decisions on one run at once are both kept (no lost update)', async () => {
  engine = createOrchestrator({ runsDir: join(root, 'runs'), swarmHome: home, home: root, exec: fakeExec({ slowDecisions: 40 }), launcher: { argv: ['autoswarm'], source: 'test' } });
  const draft = engine.saveDraft({ title: 'Two gates', workspace: ws, maxParallel: 2, steps: [
    { id: 's1', provider: 'codex', raw: true, instructions: 'APPROVE-ME one' },
    { id: 's2', provider: 'cursor', raw: true, instructions: 'APPROVE-ME two' },
  ] });
  await engine.dispatch(draft.id);
  await engine.tick();
  const waiting = engine.getRun(draft.id);
  assert.deepEqual(waiting.steps.map((step) => step.status), ['waiting', 'waiting']);
  const requestId = `approval_${'a'.repeat(32)}`;
  await Promise.all([engine.decide(draft.id, 's1', requestId, true), engine.decide(draft.id, 's2', requestId, false), engine.tick()]);
  const after = engine.getRun(draft.id);
  assert.deepEqual(after.steps.map((step) => step.pending.length), [0, 0]);
  assert.deepEqual(after.events.filter((item) => item.type.startsWith('approval-')).map((item) => `${item.type}:${item.stepId}`).sort(), ['approval-allowed:s1', 'approval-denied:s2']);
});

test('peers are opt-in: names and grants by call id, so a retried dependency stays reachable', async () => {
  const draft = engine.saveDraft(plan([
    { id: 'a', title: 'Build', provider: 'codex', instructions: 'FAIL-ME first' },
    { id: 'b', title: 'Review', provider: 'cursor', instructions: 'Review A', dependsOn: ['a'] },
  ], { peers: true }));
  await engine.dispatch(draft.id);
  assert.equal((await settle(draft.id)).status, 'needs-attention');
  assert.ok(log[0].includes('--name a') && log[0].includes('--communication-rules'));
  await engine.retryStep(draft.id, 'a', { provider: 'claude-code' });
  const run = await settle(draft.id);
  assert.equal(run.status, 'completed');
  const retried = run.steps[0].callId;
  const review = log.find((line) => line.startsWith('run --agent cursor'));
  assert.ok(log.some((line) => line.startsWith('run --agent claude-code') && line.includes('--name a-r2')));
  assert.ok(review.includes(`--name b --allow-peer ${retried} --communication-rules`), review);
  assert.match(review, /a \(Build\) as call_[a-f0-9]{32}/);
  assert.match(review, /does not read messages sent to parent/);
});
