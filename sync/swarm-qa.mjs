#!/usr/bin/env node
// sync/swarm-qa.mjs: a QA matrix for Swarm control, with dummy tasks only.
//
// Every scenario dispatches a plan through the real run engine and the real
// AutoSwarm CLI, in a throwaway workspace. Two modes:
//
//   --fixture <provider.py>   AutoSwarm's own protocol fixtures stand in for
//                             Codex (app-server), Claude Code (stream-json) and
//                             Cursor, Hermes, DeepSeek Harness (ACP). No model
//                             calls, a private AutoSwarm home, nothing shared.
//   --live --yes-spend        your installed harnesses answer tiny dummy prompts
//                             (about six calls per harness). The workspace is a
//                             temp folder; receipts land in your AutoSwarm home,
//                             run files in ~/.meow-ops/swarm/qa-runs so the
//                             helper never drives them. Your repos are not touched.
//
// Usage:
//   node sync/swarm-qa.mjs --fixture ~/Repos/AutoSwarm/tests/fixtures/provider.py --out ./qa
//   node sync/swarm-qa.mjs --live --yes-spend [--harness codex,claude-code] --out ./qa
//
// Writes qa-report.json and qa-report.md to --out (default: a temp folder).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

import { createOrchestrator } from './swarm-orchestrator.mjs';
import { resolveLauncher } from './swarm-cli.mjs';
import { autoswarmHome, findExecutable, readSwarmSnapshot } from './swarm-status.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const HARNESSES = ['codex', 'claude-code', 'cursor', 'hermes', 'dsh'];
const LABEL = { codex: 'Codex', 'claude-code': 'Claude Code', cursor: 'Cursor', hermes: 'Hermes', dsh: 'DeepSeek Harness', kimi: 'Kimi Code' };
const hex = (bytes) => randomBytes(bytes).toString('hex');
const token = (tag) => `QA-${tag}-${hex(3).toUpperCase()}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const TERMINAL = new Set(['completed', 'needs-attention', 'cancelled']);
const IN_FLIGHT = new Set(['starting', 'running', 'waiting']);

// The panel's own answer builder (TypeScript), so QA exercises the same code the UI runs.
async function loadControlLib() {
  try {
    const ts = (await import('typescript')).default;
    const source = readFileSync(new URL('../src/lib/swarm-control.ts', import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    return await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  } catch {
    return null;
  }
}

function setup() {
  const live = flag('--live');
  const fixture = value('--fixture');
  if (!live && !fixture) { console.error('Choose --fixture <AutoSwarm tests/fixtures/provider.py> or --live --yes-spend.'); process.exit(2); }
  if (live && !flag('--yes-spend')) { console.error('--live spends model calls on your harnesses. Re-run with --yes-spend to confirm.'); process.exit(2); }
  const root = mkdtempSync(join(tmpdir(), 'meow-swarm-qa-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'README.md'), '# Dummy QA workspace\n\nNothing here matters. Swarm QA writes only inside this folder.\n');
  writeFileSync(join(workspace, 'notes.txt'), 'alpha\nbeta\ngamma\n');
  // Some harnesses insist on a git repository; give them an empty one.
  if (findExecutable('git')) spawnSync('git', ['init', '-q', workspace], { stdio: 'ignore' });
  const out = resolve(value('--out') || join(root, 'report'));
  mkdirSync(out, { recursive: true });
  const traces = join(root, 'traces');
  mkdirSync(traces, { recursive: true });
  let swarmHome;
  let harnesses = (value('--harness') || HARNESSES.join(',')).split(',').map((item) => item.trim()).filter(Boolean);
  if (fixture) {
    const script = resolve(fixture);
    if (!existsSync(script)) { console.error(`Fixture not found: ${script}`); process.exit(2); }
    const python = findExecutable('python3') || findExecutable('python');
    swarmHome = join(root, 'autoswarm');
    mkdirSync(swarmHome, { recursive: true });
    const trace = (id) => `--selection-trace=${join(traces, `${id}.jsonl`)}`;
    const providers = {
      codex: { command: [python, script, 'codex', trace('codex')] },
      'claude-code': { command: [python, script, 'claude-code', trace('claude-code')] },
      // Cursor advertises a native model catalog and a reasoning control; Hermes and DSH do not.
      cursor: { command: [python, script, 'cursor', 'selection-catalog', trace('cursor')] },
      hermes: { command: [python, script, 'hermes', trace('hermes')] },
      dsh: { command: [python, script, 'dsh', trace('dsh')] },
      // A deliberately broken harness for the failure and reassign path.
      kimi: { command: [python, script, 'kimi', 'auth-required'] },
    };
    writeFileSync(join(swarmHome, 'config.json'), `${JSON.stringify({ providers }, null, 2)}\n`);
  } else {
    swarmHome = autoswarmHome();
    const snapshot = readSwarmSnapshot({ models: false });
    const found = new Set(snapshot.providers.filter((item) => item.state !== 'off').map((item) => item.id));
    harnesses = harnesses.filter((id) => found.has(id));
    if (!harnesses.length) { console.error('None of the requested harnesses is found on this machine.'); process.exit(2); }
  }
  const runsDir = live ? join(process.env.MEOW_SWARM_DIR || join(homedir(), '.meow-ops', 'swarm'), 'qa-runs') : join(root, 'runs');
  const engine = createOrchestrator({ runsDir, swarmHome });
  return { live, fixture: Boolean(fixture), root, workspace, out, traces, swarmHome, runsDir, harnesses, engine };
}

const ctx = setup();
const launcher = resolveLauncher();
if (!launcher.argv) { console.error(launcher.error); process.exit(2); }
const lib = await loadControlLib();
const timeoutMs = ctx.live ? 600_000 : 90_000;
const pollMs = ctx.live ? 1500 : 200;

// A real harness may ask for something no scenario expects. QA never approves
// on your behalf: live runs deny it (a question is declined) and the report lists it.
const unexpected = [];
function refuseUnexpected(step, pending) {
  unexpected.push({ run: step.id, provider: step.provider, kind: pending.kind, title: pending.title });
  if (pending.kind === 'question') return { answer: lib?.declinePayload?.(pending.question ?? { format: 'unknown', questions: [] }) ?? { action: 'cancel' } };
  return false;
}

/** Dispatch a plan and drive it until it settles. onPending decides approvals (true/false) or answers ({ answer }). */
async function drive(plan, { onPending = (step, pending) => (ctx.fixture ? true : refuseUnexpected(step, pending)), until = null } = {}) {
  const started = Date.now();
  const draft = ctx.engine.saveDraft({ maxParallel: 3, ...plan, workspace: ctx.workspace, tags: ['qa', ...(plan.tags ?? [])] });
  let run = await ctx.engine.dispatch(draft.id);
  let peak = run.steps.filter((step) => IN_FLIGHT.has(step.status)).length;
  while (Date.now() - started < timeoutMs) {
    await ctx.engine.tick();
    run = ctx.engine.getRun(draft.id);
    peak = Math.max(peak, run.steps.filter((step) => IN_FLIGHT.has(step.status)).length);
    for (const step of run.steps) {
      for (const pending of step.pending) {
        const verdict = await onPending(step, pending);
        run = verdict && typeof verdict === 'object'
          ? await ctx.engine.answer(draft.id, step.id, pending.requestId, verdict.answer)
          : await ctx.engine.decide(draft.id, step.id, pending.requestId, Boolean(verdict));
      }
    }
    if (until && await until(run)) break;
    if (TERMINAL.has(run.status) && !run.steps.some((step) => IN_FLIGHT.has(step.status))) break;
    await sleep(pollMs);
  }
  return { run: ctx.engine.getRun(draft.id), ms: Date.now() - started, peak };
}

/** Keep ticking an existing run (after a retry or follow-up) until it settles. */
async function settle(id) {
  const started = Date.now();
  let run = ctx.engine.getRun(id);
  while (Date.now() - started < timeoutMs) {
    await ctx.engine.tick();
    run = ctx.engine.getRun(id);
    if (TERMINAL.has(run.status) && !run.steps.some((step) => IN_FLIGHT.has(step.status) || step.status === 'queued')) break;
    await sleep(pollMs);
  }
  return run;
}

const results = [];
async function scenario(group, id, harnesses, body) {
  const started = Date.now();
  const checks = [];
  const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail: String(detail ?? '').slice(0, 300) });
  let error = null;
  let run = null;
  try {
    run = (await body(check))?.run ?? null;
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  const pass = !error && checks.length > 0 && checks.every((item) => item.ok);
  const calls = run ? run.steps.reduce((total, step) => total + step.attempts.length, 0) : 0;
  results.push({ group, id, harnesses, pass, ms: Date.now() - started, calls, runId: run?.id ?? null, checks, error });
  const failed = checks.filter((item) => !item.ok).map((item) => `${item.label}${item.detail ? ` (${item.detail})` : ''}`);
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${group.padEnd(20)} ${id}${error ? `  error: ${error}` : failed.length ? `  failed: ${failed.join('; ')}` : ''}\n`);
}

const stepOf = (run, id) => run.steps.find((step) => step.id === id);
const H = ctx.harnesses;
const fixture = ctx.fixture;
// Fixture harnesses echo their prompt; real ones need to be told what to say.
const echo = (mark) => (fixture ? mark : `Reply with exactly this token and nothing else: ${mark}`);
const traceText = (id) => { try { return readFileSync(join(ctx.traces, `${id}.jsonl`), 'utf8'); } catch { return ''; } };
const statuses = (run) => run.steps.map((step) => `${step.id}:${step.status}`).join(' ');

// 1. Each harness alone.
for (const harness of H) {
  await scenario('solo', LABEL[harness], [harness], async (check) => {
    const mark = token('SOLO');
    const { run } = await drive({ title: `QA solo ${harness}`, brief: 'Dummy QA task.', steps: [{ id: 's1', title: 'Echo', provider: harness, instructions: echo(mark) }] });
    check('run completed', run.status === 'completed', statuses(run));
    check('reply carries the token', stepOf(run, 's1')?.output?.includes(mark), stepOf(run, 's1')?.error ?? '');
    check('native session recorded', Boolean(stepOf(run, 's1')?.nativeSessionId));
    if (fixture) check('the prompt carries no messaging block', !JSON.parse(readFileSync(join(ctx.swarmHome, 'calls', stepOf(run, 's1').callId, 'task.json'), 'utf8')).communication);
    return { run };
  });
}

// 2. Handoffs: A produces, B reviews A's stitched output. Every ordered pair
// with fixtures; a ring (each harness reviews the next) when live.
const pairs = fixture ? H.flatMap((a) => H.filter((b) => b !== a).map((b) => [a, b])) : H.map((a, index) => [a, H[(index + 1) % H.length]]).filter(([a, b]) => a !== b);
for (const [a, b] of pairs) {
  await scenario('handoff', `${LABEL[a]} → ${LABEL[b]}`, [a, b], async (check) => {
    const mark = token('HANDOFF');
    const { run } = await drive({ title: `QA handoff ${a} to ${b}`, brief: 'Dummy QA handoff.', steps: [
      { id: 's1', title: 'Produce', provider: a, instructions: echo(mark) },
      { id: 's2', title: 'Review', kind: 'review', provider: b, dependsOn: ['s1'], instructions: fixture ? 'Review the input.' : 'Repeat the QA token you find in the inputs, exactly, and nothing else.' },
    ] });
    check('both steps completed', run.status === 'completed', statuses(run));
    check("B received A's output", stepOf(run, 's2')?.output?.includes(mark));
    check('B started after A finished', Date.parse(stepOf(run, 's2')?.startedAt ?? '') >= Date.parse(stepOf(run, 's1')?.finishedAt ?? '') - 1000);
    return { run };
  });
}

// 3. Fan-out to the other harnesses, stitched by each harness in turn (one integrator when live).
for (const integrator of fixture ? H : H.slice(0, 1)) {
  const workers = H.filter((id) => id !== integrator);
  if (!workers.length) continue;
  await scenario('fan-out + stitch', `${workers.length} workers → ${LABEL[integrator]}`, [...workers, integrator], async (check) => {
    const marks = workers.map(() => token('PART'));
    const { run, peak } = await drive({ title: `QA fan-out into ${integrator}`, brief: 'Dummy QA fan-out.', maxParallel: 4, steps: [
      ...workers.map((worker, index) => ({ id: `w${index + 1}`, title: `Part ${index + 1}`, provider: worker, instructions: echo(marks[index]) })),
      { id: 'join', title: 'Stitch', kind: 'integrate', provider: integrator, dependsOn: workers.map((_, index) => `w${index + 1}`), instructions: fixture ? 'Combine the parts.' : 'List every QA token you find in the inputs, one per line, and nothing else.' },
    ] });
    check('run completed', run.status === 'completed', statuses(run));
    check('workers dispatched together', peak >= Math.min(workers.length, 2), `peak ${peak} in flight`);
    const merged = stepOf(run, 'join')?.output ?? '';
    check('integrator received every part', marks.every((mark) => merged.includes(mark)), `${marks.filter((mark) => merged.includes(mark)).length}/${marks.length}`);
    check('integrator started after the last worker', Date.parse(stepOf(run, 'join')?.startedAt ?? '') >= Math.max(...workers.map((_, index) => Date.parse(stepOf(run, `w${index + 1}`)?.finishedAt ?? ''))) - 1000);
    return { run };
  });
}

// 4. A diamond across all five: one plan, three levels, every harness owns a step.
if (H.length >= 5) {
  const [a, b, c, d, e] = H;
  await scenario('diamond', `${LABEL[a]} → ${LABEL[b]} + ${LABEL[c]} → ${LABEL[d]} → ${LABEL[e]}`, H.slice(0, 5), async (check) => {
    const mark = token('ROOT');
    const relay = fixture ? 'Pass the input on.' : 'Repeat the QA token you find in the inputs, exactly.';
    const { run } = await drive({ title: 'QA diamond', brief: 'Dummy QA diamond.', maxParallel: 3, steps: [
      { id: 'root', title: 'Root', provider: a, instructions: echo(mark) },
      { id: 'left', title: 'Left', provider: b, dependsOn: ['root'], instructions: relay },
      { id: 'right', title: 'Right', provider: c, dependsOn: ['root'], instructions: relay },
      { id: 'merge', title: 'Merge', kind: 'integrate', provider: d, dependsOn: ['left', 'right'], instructions: relay },
      { id: 'check', title: 'Check', kind: 'review', provider: e, dependsOn: ['merge'], instructions: relay },
    ] });
    check('all five steps completed', run.status === 'completed', statuses(run));
    check('the root token survived three hops', stepOf(run, 'check')?.output?.includes(mark));
    check('left and right were dispatched together', Math.abs(Date.parse(stepOf(run, 'right')?.startedAt ?? '') - Date.parse(stepOf(run, 'left')?.startedAt ?? '')) < 5000);
    return { run };
  });
}

if (fixture) {
  // 5. Model and effort reach the native harness, or are refused in the open.
  await scenario('model + effort', 'a native model reaches every harness', H, async (check) => {
    const model = `qa-model-${hex(3)}`;
    const { run } = await drive({ title: 'QA model selection', maxParallel: 5, steps: H.map((harness, index) => ({ id: `m${index + 1}`, title: harness, provider: harness, model, instructions: token('MODEL') })) });
    check('every step completed', run.steps.every((step) => step.status === 'completed'), statuses(run));
    const reached = H.filter((harness) => traceText(harness).includes(model));
    check('each harness received the model', reached.length === H.length, `${reached.length}/${H.length}: ${reached.join(', ')}`);
    return { run };
  });
  await scenario('model + effort', 'effort accepted where the harness offers it', ['codex', 'claude-code', 'cursor'], async (check) => {
    const { run } = await drive({ title: 'QA effort accepted', maxParallel: 3, steps: [
      { id: 'e1', title: 'codex', provider: 'codex', effort: 'high', instructions: token('EFFORT') },
      { id: 'e2', title: 'claude', provider: 'claude-code', effort: 'high', instructions: token('EFFORT') },
      { id: 'e3', title: 'cursor', provider: 'cursor', effort: 'deep-native', instructions: token('EFFORT') },
    ] });
    check('all three completed', run.status === 'completed', statuses(run));
    check('Codex got effort on the turn', /"effort": ?"high"/.test(traceText('codex')));
    check('Claude Code got --effort high', /"--effort", ?"high"/.test(traceText('claude-code')));
    check("Cursor's reasoning control was set", /"configId": ?"reasoning", ?"value": ?"deep-native"/.test(traceText('cursor')));
    return { run };
  });
  await scenario('model + effort', 'effort refused where the harness has no such control', ['cursor', 'hermes', 'dsh'], async (check) => {
    const { run } = await drive({ title: 'QA effort refused', maxParallel: 3, steps: [
      { id: 'r1', title: 'cursor', provider: 'cursor', effort: 'high', instructions: token('EFFORT') },
      { id: 'r2', title: 'hermes', provider: 'hermes', effort: 'high', instructions: token('EFFORT') },
      { id: 'r3', title: 'dsh', provider: 'dsh', effort: 'high', instructions: token('EFFORT') },
    ] });
    check('every step failed visibly', run.steps.every((step) => step.status === 'failed'), statuses(run));
    check('Cursor lists its native choices', /native choices: deep-native, light-native/.test(stepOf(run, 'r1')?.error ?? ''), stepOf(run, 'r1')?.error);
    check('Hermes and DSH say they have no effort control', ['r2', 'r3'].every((id) => /reasoning-effort control/.test(stepOf(run, id)?.error ?? '')), stepOf(run, 'r2')?.error);
    check('the run asks for attention instead of guessing', run.status === 'needs-attention', run.status);
    return { run };
  });

  // 6. Approvals, allowed and denied, on every protocol family.
  for (const allow of [true, false]) {
    for (const harness of H) {
      await scenario(allow ? 'approval: allow' : 'approval: deny', LABEL[harness], [harness], async (check) => {
        const marker = join(ctx.workspace, `approval-${harness}-${allow ? 'allow' : 'deny'}.txt`);
        let asked = 0;
        const { run } = await drive({ title: `QA approval ${allow ? 'allow' : 'deny'} ${harness}`, steps: [{ id: 's1', title: 'Ask first', provider: harness, raw: true, instructions: `approval:${marker}` }] }, {
          onPending: (_, pending) => { asked += 1; return pending.kind === 'permission' ? allow : false; },
        });
        check('the step waited for one decision', asked === 1, `${asked} asked`);
        check('the step finished', stepOf(run, 's1')?.status === 'completed', statuses(run));
        check(allow ? 'the action ran after approval' : 'the action never ran', allow ? existsSync(marker) : !existsSync(marker));
        check('the harness was told the decision', stepOf(run, 's1')?.output?.startsWith(allow ? 'approved' : 'denied'), stepOf(run, 's1')?.output?.slice(0, 40));
        return { run };
      });
    }
  }

  // 7. A native question (Claude Code's AskUserQuestion), answered with the panel's builder.
  if (H.includes('claude-code')) {
    await scenario('question', 'Claude Code asks, the panel answers', ['claude-code'], async (check) => {
      const marker = join(ctx.workspace, 'question-claude.txt');
      let seen = null;
      let reply = null;
      const { run } = await drive({ title: 'QA question', steps: [{ id: 's1', title: 'Ask', provider: 'claude-code', raw: true, instructions: `question:${marker}` }] }, {
        onPending: (_, pending) => {
          seen = pending;
          const question = pending.question?.questions?.[0];
          const option = question?.options?.find((item) => item.label === '本地');
          if (!lib || !question || !option) return false;
          reply = lib.answerPayload(pending.question, lib.togglePick(lib.emptyAnswer(), question, option.id));
          return { answer: reply };
        },
      });
      check('surfaced as a question, not a permission', seen?.kind === 'question' && seen?.question?.format === 'claude-question', `${seen?.kind} ${seen?.question?.format}`);
      check('question text and options came through', seen?.question?.questions?.[0]?.text === 'Choose scope?' && seen.question.questions[0].options.map((item) => item.label).join('|') === '本地|Shared');
      check("the panel's builder made the native reply", JSON.stringify(reply) === JSON.stringify({ answers: { 'Choose scope?': '本地' } }), JSON.stringify(reply));
      check('the harness accepted the answer', existsSync(marker) && readFileSync(marker, 'utf8') === 'answered');
      check('the step completed', stepOf(run, 's1')?.status === 'completed', statuses(run));
      return { run };
    });
  }

  // 8. A broken harness fails its branch; reassigning it unblocks the dependent.
  await scenario('failure + reassign', 'Kimi (signed out) → retry on Codex', ['kimi', 'codex', 'claude-code'], async (check) => {
    const mark = token('RETRY');
    let { run } = await drive({ title: 'QA failure and reassign', steps: [
      { id: 's1', title: 'Fragile', provider: 'kimi', instructions: mark },
      { id: 's2', title: 'Depends', provider: 'claude-code', dependsOn: ['s1'], instructions: 'Use the input.' },
    ] });
    check('the broken harness failed visibly', stepOf(run, 's1')?.status === 'failed', `${stepOf(run, 's1')?.errorCode}: ${stepOf(run, 's1')?.error}`);
    check('its dependent was blocked, not run', stepOf(run, 's2')?.status === 'blocked' && !stepOf(run, 's2')?.callId);
    check('the run asked for attention', run.status === 'needs-attention', run.status);
    await ctx.engine.retryStep(run.id, 's1', { provider: 'codex' });
    run = await settle(run.id);
    check('the retry completed on Codex', stepOf(run, 's1')?.status === 'completed' && stepOf(run, 's1')?.provider === 'codex', statuses(run));
    check('the dependent ran with the retry output', stepOf(run, 's2')?.output?.includes(mark));
    check('both attempts are on record', stepOf(run, 's1')?.attempts.length === 2, stepOf(run, 's1')?.attempts.map((item) => `${item.provider}:${item.status}`).join(' '));
    return { run };
  });

  // 9. Cancel stops running work and never starts queued work.
  await scenario('cancel', 'cancel a run mid-flight', ['codex', 'hermes', 'claude-code'], async (check) => {
    let cancelled = false;
    const { run } = await drive({ title: 'QA cancel', steps: [
      { id: 's1', title: 'Hold', provider: 'codex', raw: true, instructions: `hold:${join(ctx.workspace, 'hold-codex')}` },
      { id: 's2', title: 'Hold', provider: 'hermes', raw: true, instructions: `hold:${join(ctx.workspace, 'hold-hermes')}` },
      { id: 's3', title: 'Never starts', provider: 'claude-code', dependsOn: ['s1'], instructions: 'Should be cancelled.' },
    ] }, {
      until: async (current) => {
        const holding = ['hold-codex', 'hold-hermes'].every((name) => existsSync(join(ctx.workspace, name)));
        if (holding && !cancelled) { cancelled = true; await ctx.engine.cancelRun(current.id); }
        return false;
      },
    });
    check('both agents were mid-task when cancelled', cancelled);
    check('run cancelled', run.status === 'cancelled', run.status);
    check('running steps cancelled', ['s1', 's2'].every((id) => stepOf(run, id)?.status === 'cancelled'), statuses(run));
    check('queued step never started', stepOf(run, 's3')?.status === 'cancelled' && !stepOf(run, 's3')?.callId);
    return { run };
  });

  // 10. Max parallel holds even when five steps are ready at once.
  await scenario('concurrency', 'five ready steps, two at a time', H, async (check) => {
    const gate = join(ctx.workspace, `gate-${hex(2)}`);
    let peak = 0;
    let held = false;
    const { run } = await drive({ title: 'QA concurrency', maxParallel: 2, steps: H.map((harness, index) => ({ id: `c${index + 1}`, title: harness, provider: harness, raw: true, instructions: `gate:${gate}\n${token('GATE')}` })) }, {
      until: async (current) => {
        peak = Math.max(peak, current.steps.filter((step) => IN_FLIGHT.has(step.status)).length);
        if (!held && current.steps.filter((step) => step.status === 'running').length === 2) {
          held = true;
          for (let i = 0; i < 4; i += 1) { await ctx.engine.tick(); peak = Math.max(peak, ctx.engine.getRun(current.id).steps.filter((step) => IN_FLIGHT.has(step.status)).length); await sleep(150); }
          writeFileSync(gate, 'open');
        }
        return false;
      },
    });
    check('two were held while three waited', held);
    check('never more than two at once', peak <= 2, `peak ${peak}`);
    check('all five completed', run.steps.every((step) => step.status === 'completed'), statuses(run));
    return { run };
  });

  // 11. Peers: one controller per run; dependents may message the steps they depend on.
  await scenario('peers', 'one controller, scoped peer grants', ['codex', 'cursor'], async (check) => {
    const { run } = await drive({ title: 'QA peers', peers: true, steps: [
      { id: 'build', title: 'Build', provider: 'codex', instructions: token('PEER') },
      { id: 'review', title: 'Review', kind: 'review', provider: 'cursor', dependsOn: ['build'], instructions: 'Review it.' },
    ] });
    const task = (id) => JSON.parse(readFileSync(join(ctx.swarmHome, 'calls', stepOf(run, id).callId, 'task.json'), 'utf8'));
    check('run completed', run.status === 'completed', statuses(run));
    check('both calls share the run controller', task('build').controller_id === run.controllerId && task('review').controller_id === run.controllerId, run.controllerId);
    check('the controller is private to this run', /^main_[a-f0-9]{32}$/.test(run.controllerId ?? ''));
    check('review may message build, and only build', JSON.stringify(task('review').communication?.peers) === JSON.stringify([stepOf(run, 'build').callId]), JSON.stringify(task('review').communication?.peers));
    check('build was told nobody is its to message', /No other step is yours to message/.test(task('build').communication?.rules ?? ''), task('build').communication?.rules);
    return { run };
  });

  // 12. Breakdown plumbing: the fixture echoes the planning prompt, whose JSON shape must parse into an editable plan.
  await scenario('breakdown', 'agent-drafted plan comes back editable', ['codex'], async (check) => {
    let run = await ctx.engine.draftPlan({ brief: 'Add a dummy feature with tests.', workspace: ctx.workspace, provider: 'codex', providers: H.map((id) => ({ id, label: LABEL[id] })) });
    run = await settle(run.id);
    check('planning call completed', run.status === 'completed', statuses(run));
    check('a plan was parsed from the reply', Array.isArray(run.proposal?.steps) && run.proposal.steps.length >= 1);
    check('parsed providers are real harnesses', (run.proposal?.steps ?? []).every((step) => H.includes(step.provider)));
    return { run };
  });
}

// 13. Follow-up resumes the same native session, on every harness.
for (const harness of H) {
  await scenario('follow-up', LABEL[harness], [harness], async (check) => {
    const phrase = `AUTOSWARM_QA_${hex(4).toUpperCase()}`;
    let { run } = await drive({ title: `QA follow-up ${harness}`, steps: [{ id: 's1', title: 'Remember', provider: harness, instructions: fixture ? `Remember the exact phrase ${phrase}.` : `Remember the exact phrase ${phrase}. Reply only with OK.` }] });
    const session = stepOf(run, 's1')?.nativeSessionId;
    check('first turn completed', stepOf(run, 's1')?.status === 'completed', stepOf(run, 's1')?.error ?? statuses(run));
    if (stepOf(run, 's1')?.status !== 'completed') return { run };
    await ctx.engine.followUp(run.id, 's1', 'What exact phrase did I ask you to remember? Reply with the phrase only.');
    run = await settle(run.id);
    const output = stepOf(run, 's1')?.output ?? '';
    check('the resumed turn completed', stepOf(run, 's1')?.status === 'completed', statuses(run));
    check('same native session', Boolean(session) && stepOf(run, 's1')?.nativeSessionId === session, `${session} → ${stepOf(run, 's1')?.nativeSessionId}`);
    check('it remembered the phrase', output.includes(phrase), output.slice(0, 80));
    check('no replayed transcript leaked into the answer', !output.includes('OLD TRANSCRIPT'));
    return { run };
  });
}

const passed = results.filter((item) => item.pass).length;
const groups = [...new Set(results.map((item) => item.group))].map((group) => {
  const rows = results.filter((item) => item.group === group);
  return { group, total: rows.length, passed: rows.filter((item) => item.pass).length };
});
const report = {
  generatedAt: new Date().toISOString(),
  mode: ctx.live ? 'live' : 'fixture',
  harnesses: ctx.harnesses,
  workspace: ctx.workspace,
  autoswarmHome: ctx.swarmHome,
  runsDir: ctx.runsDir,
  launcher: launcher.source,
  answerBuilder: lib ? 'src/lib/swarm-control.ts' : 'unavailable',
  unexpectedRequests: unexpected,
  totals: { scenarios: results.length, passed, failed: results.length - passed, calls: results.reduce((total, item) => total + item.calls, 0), checks: results.reduce((total, item) => total + item.checks.length, 0) },
  groups,
  results,
};
writeFileSync(join(ctx.out, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
const cell = (text) => String(text).replaceAll('|', '\\|').replace(/\s+/g, ' ');
const md = [
  `# Swarm control QA (${report.mode})`,
  '',
  `${report.generatedAt} · **${passed}/${results.length} scenarios passed** · ${report.totals.checks} checks · ${report.totals.calls} AutoSwarm calls`,
  '',
  `Dummy workspace: \`${ctx.workspace}\` · AutoSwarm home: \`${ctx.swarmHome}\``,
  '',
  ...(unexpected.length ? [`Unexpected requests, denied or declined by QA (never approved): ${unexpected.map((item) => `${item.provider} ${item.kind} "${item.title}"`).join('; ')}`, ''] : []),
  '| Group | Passed |',
  '| --- | --- |',
  ...groups.map((item) => `| ${item.group} | ${item.passed}/${item.total} |`),
  '',
  '| Group | Scenario | Harnesses | Result | Calls | Time | Evidence |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...results.map((item) => `| ${item.group} | ${cell(item.id)} | ${item.harnesses.map((id) => LABEL[id] ?? id).join(', ')} | ${item.pass ? 'PASS' : '**FAIL**'} | ${item.calls} | ${(item.ms / 1000).toFixed(1)}s | ${cell(item.error ? `error: ${item.error}` : item.checks.map((entry) => `${entry.ok ? 'ok' : 'NO'} ${entry.label}${entry.detail && !entry.ok ? ` (${entry.detail})` : ''}`).join('; '))} |`),
  '',
].join('\n');
writeFileSync(join(ctx.out, 'qa-report.md'), md);
console.log(`\n${passed}/${results.length} scenarios passed (${report.totals.checks} checks, ${report.totals.calls} AutoSwarm calls). Report: ${join(ctx.out, 'qa-report.md')}`);
process.exit(passed === results.length ? 0 : 1);
