// Swarm control page helpers: templates, plan checks, pipeline layout, command
// previews, and a client that never calls the helper from the hosted shell and
// always fetches a one-use nonce before making AutoSwarm act.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../../src/lib/swarm-control.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const runFixture = (status = 'running') => ({ schemaVersion: 1, id: 'run_20261103120000_abcdef', status, steps: [{ id: 's1', status: 'running', provider: 'codex', dependsOn: [] }], events: [] });

test('the hosted shell never calls the helper', async () => {
  const client = api.createSwarmControlClient({ hostname: 'meow-ops.vercel.app', fetcher: async () => assert.fail('must not fetch') });
  await assert.rejects(client.listRuns(), /local dashboard only/);
  await assert.rejects(client.dispatch('run_20261103120000_abcdef'), /local dashboard only/);
});

test('acting needs a fresh nonce; drafting does not', async () => {
  const calls = [];
  const client = api.createSwarmControlClient({
    hostname: '127.0.0.1',
    fetcher: async (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null, header: init.headers['x-meow-ops-local'] });
      if (path === '/swarm/nonce') return new Response(JSON.stringify({ nonce: `n${calls.length}` }));
      return new Response(JSON.stringify({ ok: true, run: runFixture() }), { status: 200 });
    },
  });
  await client.saveDraft({ title: 't', brief: '', workspace: '/w', maxParallel: 2, peers: false, tags: [], steps: [] });
  await client.decide('run_20261103120000_abcdef', 's1', `approval_${'a'.repeat(32)}`, 'allow');
  assert.deepEqual(calls.map((item) => `${item.method} ${item.path}`), [
    'POST /swarm/runs', 'GET /swarm/nonce', 'POST /swarm/runs/run_20261103120000_abcdef/steps/s1/decide',
  ]);
  assert.equal(calls[0].body.plan.title, 't');
  assert.equal(calls[2].body.nonce, 'n2');
  assert.equal(calls[2].body.decision, 'allow');
  assert.ok(calls.every((item) => item.header === '1'));

  const refusing = api.createSwarmControlClient({ hostname: 'localhost', fetcher: async () => new Response(JSON.stringify({ ok: false, error: '[nonce] invalid or already used nonce' }), { status: 403 }) });
  await assert.rejects(refusing.getRun('run_20261103120000_abcdef'), /^Error: invalid or already used nonce$/);
  const unverifiable = api.createSwarmControlClient({ hostname: 'localhost', fetcher: async () => new Response(JSON.stringify({ ok: true, run: { id: 'x' } })) });
  await assert.rejects(unverifiable.getRun('run_20261103120000_abcdef'), /cannot verify/);
});

test('templates give editable skeletons that rotate across found harnesses', () => {
  const fan = api.planTemplate('fan-out', ['codex', 'claude-code']);
  assert.deepEqual(fan.map((step) => step.provider), ['codex', 'claude-code', 'codex', 'codex']);
  assert.deepEqual(fan[3].dependsOn, ['s1', 's2', 's3']);
  assert.equal(fan[3].kind, 'integrate');
  const review = api.planTemplate('build-review', ['codex', 'cursor', 'hermes']);
  assert.equal(review[1].provider, 'cursor');
  assert.equal(review[1].kind, 'review');
  assert.deepEqual(review[2].dependsOn, ['s1', 's2']);
  assert.equal(api.planTemplate('compare', ['a']).length, 4);
  assert.equal(api.planTemplate('blank', []).length, 1);
  assert.equal(api.nextStepId(fan), 's5');
  assert.equal(api.nextStepId([{ id: 's2' }]), 's3');
});

test('plan checks mirror the helper so problems show before dispatch', () => {
  const base = { title: '', brief: '', workspace: '/w', maxParallel: 2, peers: false, tags: [] };
  assert.deepEqual(api.planProblems({ ...base, steps: [] }), ['Add at least one step.']);
  const problems = api.planProblems({ ...base, workspace: ' ', steps: [
    { id: 's1', provider: 'codex', instructions: 'x', dependsOn: ['s2'], model: 'bad model', effort: null, kind: 'execute', title: '', raw: false },
    { id: 's2', provider: '', instructions: '', dependsOn: [], model: null, effort: null, kind: 'execute', title: '', raw: false },
  ] });
  assert.ok(problems.includes('Choose a workspace folder.'));
  assert.ok(problems.some((line) => /depends on s2, which must come earlier/.test(line)));
  assert.ok(problems.some((line) => /model must be a native id/.test(line)));
  assert.ok(problems.some((line) => /choose a harness/.test(line)));
  assert.ok(problems.some((line) => /write what it should do/.test(line)));
});

test('the pipeline lays steps out by dependency depth', () => {
  const layout = api.pipelineLayout([
    { id: 'a', dependsOn: [] }, { id: 'b', dependsOn: [] }, { id: 'c', dependsOn: ['a'] }, { id: 'd', dependsOn: ['b', 'c'] },
  ]);
  assert.deepEqual(layout.nodes, [{ id: 'a', level: 0, row: 0 }, { id: 'b', level: 0, row: 1 }, { id: 'c', level: 1, row: 0 }, { id: 'd', level: 2, row: 0 }]);
  assert.equal(layout.levels, 3);
  assert.equal(layout.rows, 2);
  assert.equal(layout.edges.length, 3);
  assert.deepEqual(api.pipelineLayout([]).levels, 0);
});

test('command previews are exact and quoted; the final step is the last integrator', () => {
  assert.equal(api.stepCommand({ id: 's1', provider: 'dsh', model: 'anthropic/claude-opus-5.5', effort: 'low', dependsOn: [] }, '~/My Work'),
    "autoswarm run --agent dsh --cwd '~/My Work' --model anthropic/claude-opus-5.5 --effort low --background --no-parent --input prompts/s1-1.md");
  assert.equal(api.stepCommand({ id: 's2', provider: 'codex', model: null, effort: null, dependsOn: ['s1'] }, '/w', true),
    'autoswarm run --agent codex --cwd /w --background --no-parent --input prompts/s2-1.md --name s2 --allow-peer <s1 call>');
  const steps = [{ id: 'a', kind: 'execute', dependsOn: [] }, { id: 'b', kind: 'review', dependsOn: ['a'] }, { id: 'c', kind: 'execute', dependsOn: [] }];
  assert.equal(api.finalStep(steps).id, 'b');
  assert.equal(api.finalStep([{ id: 'x', kind: 'execute', dependsOn: [] }]).id, 'x');
  assert.equal(api.elapsed(null, null, Date.now()), 'Not started');
  assert.equal(api.elapsed('2026-11-03T00:00:00Z', '2026-11-03T00:01:05Z', 0), '1m 5s');
});

test('answers are shaped per native format; nothing is sent until every question has one', () => {
  const claude = { format: 'claude-question', help: null, userRequired: false, questions: [
    { key: 'Which database?', text: 'Which database?', multi: false, options: [{ id: 'Postgres', label: 'Postgres' }, { id: 'SQLite', label: 'SQLite' }] },
    { key: 'Which checks?', text: 'Which checks?', multi: true, options: [{ id: 'Lint', label: 'Lint' }, { id: 'Tests', label: 'Tests' }] },
  ] };
  let draft = api.togglePick(api.emptyAnswer(), claude.questions[0], 'SQLite');
  draft = api.togglePick(draft, claude.questions[0], 'Postgres');
  assert.equal(api.answerPayload(claude, draft), null);
  draft = api.togglePick(api.togglePick(draft, claude.questions[1], 'Lint'), claude.questions[1], 'Tests');
  assert.deepEqual(api.answerPayload(claude, draft), { answers: { 'Which database?': 'Postgres', 'Which checks?': ['Lint', 'Tests'] } });
  assert.deepEqual(api.answerPayload(claude, { ...draft, text: { 'Which database?': '  MySQL  ' } }).answers['Which database?'], 'MySQL');
  assert.deepEqual(api.declinePayload(claude), { action: 'cancel' });

  const one = (format, key, options, extra = {}) => ({ format, help: null, userRequired: false, questions: [{ key, text: 'Q', multi: false, options, ...extra }] });
  const pick = (detail, id) => api.togglePick(api.emptyAnswer(), detail.questions[0], id);
  const codex = one('codex-question', 'scope', [{ id: 'Local', label: 'Local' }]);
  assert.deepEqual(api.answerPayload(codex, pick(codex, 'Local')), { answers: { scope: { answers: ['Local'] } } });
  assert.deepEqual(api.declinePayload(codex), { answers: { scope: { answers: [] } } });
  const cursor = one('cursor-question', 'q1', [{ id: 'opt-a', label: 'A' }]);
  assert.deepEqual(api.answerPayload(cursor, pick(cursor, 'opt-a')), { outcome: 'answered', answers: [{ questionId: 'q1', selectedOptionIds: ['opt-a'] }] });
  assert.equal(api.allowsText('cursor-question', cursor.questions[0]), false);
  assert.deepEqual(api.answerPayload(cursor, { picks: {}, text: { q1: 'typed text is ignored' } }), null);
  const acp = one('acp-question', 'option', [{ id: 'yes-1', label: 'Yes' }]);
  assert.deepEqual(api.answerPayload(acp, pick(acp, 'yes-1')), { optionId: 'yes-1' });
  const opencode = one('opencode-question', '0', [{ id: 'A', label: 'A' }], { custom: false });
  assert.equal(api.allowsText('opencode-question', opencode.questions[0]), false);
  assert.deepEqual(api.answerPayload(opencode, pick(opencode, 'A')), { answers: [['A']] });
  const muse = one('muse-question', 'm1', [{ id: 'Fast', label: 'Fast' }]);
  assert.deepEqual(api.answerPayload(muse, { picks: {}, text: { m1: 'Neither' } }), { action: 'answer', answers: [{ questionId: 'm1', freeText: 'Neither' }] });
  const asyncQ = one('codex-async-question', 'text', []);
  assert.deepEqual(api.answerPayload(asyncQ, { picks: {}, text: { text: 'Use the staging DB' } }), { text: 'Use the staging DB' });
  assert.equal(api.declinePayload(asyncQ), null);
  assert.equal(api.answerPayload({ format: 'elicitation', help: null, userRequired: true, questions: [] }, api.emptyAnswer()), null);
});

test('answer relays through the owner nonce like every acting call', async () => {
  const calls = [];
  const client = api.createSwarmControlClient({
    hostname: '127.0.0.1',
    fetcher: async (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify(path === '/swarm/nonce' ? { nonce: 'n-1' } : { ok: true, run: runFixture() }));
    },
  });
  await client.answer('run_20261103120000_abcdef', 's1', `approval_${'b'.repeat(32)}`, { answers: { Q: 'A' } });
  assert.deepEqual(calls.map((item) => item.path), ['/swarm/nonce', '/swarm/runs/run_20261103120000_abcdef/steps/s1/answer']);
  assert.deepEqual(calls[1].body, { requestId: `approval_${'b'.repeat(32)}`, response: { answers: { Q: 'A' } }, nonce: 'n-1' });
});

test('known AutoSwarm errors come with a next step that names the harness', () => {
  assert.match(api.errorHint('native_auth_required', 'Kimi Code'), /^Sign in to Kimi Code in its own app or CLI/);
  assert.match(api.errorHint('unsupported_effort', 'Hermes'), /Hermes has no such effort control/);
  assert.equal(api.errorHint('something_new', 'Codex'), null);
  assert.equal(api.errorHint(null, 'Codex'), null);
});
