// sync/swarm-orchestrator.mjs: the Swarm control panel's run engine.
//
// A run is a plan you wrote or an agent drafted: steps, each owned by one
// harness (and optionally a native model and effort), joined by dependencies
// into a DAG. On dispatch the engine starts every ready step as an AutoSwarm
// background call, watches AutoSwarm's receipts, starts dependents when their
// inputs arrive, and stitches upstream outputs into each dependent's prompt.
//
// Meow Ops governs and AutoSwarm plus the native agents execute: nothing runs
// until you dispatch, approvals wait for your decision, failures stop their
// branch until you retry or reassign, and nothing is ever re-run blindly.
//
// State lives in ~/.meow-ops/swarm/runs/<run>/run.json (MEOW_SWARM_DIR).

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { execAutoswarm, resolveLauncher } from './swarm-cli.mjs';
import { PROVIDERS, autoswarmHome, canonicalProvider, readCallReceipt } from './swarm-status.mjs';

export const RUN_SCHEMA_VERSION = 1;
export const STEP_KINDS = Object.freeze(['execute', 'review', 'integrate']);
const LABEL = Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider.label]));
const RUN_ID = /^run_[0-9]{14}_[a-f0-9]{6}$/;
const STEP_ID = /^[a-z][a-z0-9-]{0,23}$/;
const REQUEST_ID = /^approval_[a-f0-9]{32}$/;
const NATIVE_VALUE = /^[A-Za-z0-9][\w.:/@[\]=,+-]{0,79}$/;
const ACTIVE = new Set(['starting', 'running', 'waiting']);
const FINAL_BAD = new Set(['failed', 'cancelled', 'interrupted', 'blocked']);
const OUTPUT_KEEP = 64_000;
const INPUT_SHARE = 12_000;
const MAX_EVENTS = 400;

export class PlanError extends Error {
  constructor(message) { super(message); this.code = 'invalid_plan'; }
}

export function defaultRunsDir({ env = process.env, home = homedir() } = {}) {
  return join(env.MEOW_SWARM_DIR || join(home, '.meow-ops', 'swarm'), 'runs');
}

const text = (value, max) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const nativeValue = (value, field) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !NATIVE_VALUE.test(value.trim())) throw new PlanError(`${field} must be a native id without spaces (letters, digits and . : / @ [ ] = , + - _).`);
  return value.trim();
};
const nowIso = (now) => new Date(now()).toISOString();
const stamp = (now) => new Date(now()).toISOString().replace(/[-:T]/g, '').slice(0, 14);
const expandHome = (value, home) => (value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value);

/**
 * Validate and normalise a plan. Throws PlanError with a sentence a person can
 * act on. Dependencies must point at earlier steps, which also rules out cycles.
 */
export function normalizePlan(input, { home = homedir(), available = null } = {}) {
  if (!input || typeof input !== 'object') throw new PlanError('A plan is required.');
  const title = text(input.title, 120) || 'Untitled run';
  const brief = text(input.brief, 8000);
  const rawWorkspace = text(input.workspace, 1000);
  if (!rawWorkspace) throw new PlanError('Choose a workspace folder for this run.');
  const workspace = resolve(expandHome(rawWorkspace, home));
  if (!isAbsolute(workspace)) throw new PlanError('The workspace must be an absolute folder path.');
  let isDir = false;
  try { isDir = statSync(workspace).isDirectory(); } catch { /* reported below */ }
  if (!isDir) throw new PlanError(`The workspace folder does not exist: ${workspace}`);
  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (steps.length === 0) throw new PlanError('Add at least one step.');
  if (steps.length > 24) throw new PlanError('A run holds at most 24 steps.');
  const seen = new Set();
  const normalised = steps.map((step, index) => {
    const id = text(step?.id, 24).toLowerCase() || `s${index + 1}`;
    if (!STEP_ID.test(id)) throw new PlanError(`Step ${index + 1}: ids use lowercase letters, digits and dashes.`);
    if (seen.has(id)) throw new PlanError(`Step id ${id} is used twice.`);
    const provider = canonicalProvider(step?.provider);
    if (!provider) throw new PlanError(`Step ${id}: choose a harness.`);
    if (available && !available.includes(provider)) throw new PlanError(`Step ${id}: ${LABEL[provider]} is not available on this machine.`);
    const instructions = text(step?.instructions, 8000);
    if (!instructions) throw new PlanError(`Step ${id}: write what this step should do.`);
    const dependsOn = [...new Set((Array.isArray(step?.dependsOn) ? step.dependsOn : []).map((dep) => text(dep, 24).toLowerCase()).filter(Boolean))];
    for (const dep of dependsOn) if (!seen.has(dep)) throw new PlanError(`Step ${id} depends on ${dep}, which must come earlier in the plan.`);
    const kind = STEP_KINDS.includes(step?.kind) ? step.kind : 'execute';
    seen.add(id);
    return {
      id,
      title: text(step?.title, 120) || `Step ${index + 1}`,
      kind,
      instructions,
      dependsOn,
      provider,
      model: nativeValue(step?.model, `Step ${id} model`),
      effort: nativeValue(step?.effort, `Step ${id} effort`),
      raw: step?.raw === true,
    };
  });
  const maxParallel = Number.isInteger(input.maxParallel) ? Math.min(8, Math.max(1, input.maxParallel)) : 3;
  return { title, brief, workspace, maxParallel, peers: input.peers === true, steps: normalised, tags: (Array.isArray(input.tags) ? input.tags : []).map((tag) => text(tag, 24)).filter(Boolean).slice(0, 6) };
}

function truncate(value, max) {
  if (typeof value !== 'string') return '';
  return value.length > max ? `${value.slice(0, max)}\n[... ${value.length - max} more characters kept in the AutoSwarm receipt]` : value;
}

const KIND_RULES = {
  execute: 'Produce the deliverable for this step only. Do not redo other steps.',
  review: 'Review the inputs below. Do not edit files. Report findings, risks and a verdict: ship, or fix first.',
  integrate: 'Combine the inputs below into one deliverable. Resolve conflicts explicitly and say which input each part came from.',
};

/** The prompt AutoSwarm hands the harness: your instructions first, then run context and upstream outputs. */
export function buildPrompt(run, step) {
  if (step.raw) return step.instructions;
  const byId = new Map(run.steps.map((item) => [item.id, item]));
  const lines = [
    step.instructions,
    '',
    '---',
    `Context from Meow Ops: run "${run.title}", step ${step.id} (${step.kind}), ${run.steps.findIndex((item) => item.id === step.id) + 1} of ${run.steps.length}.`,
  ];
  if (run.brief) lines.push(`Run goal: ${run.brief}`);
  lines.push(`Workspace: ${run.workspace}. Work only inside it.`, KIND_RULES[step.kind]);
  const inputs = step.dependsOn.map((id) => byId.get(id)).filter(Boolean);
  if (inputs.length) {
    lines.push('', 'Inputs from earlier steps:');
    for (const input of inputs) {
      lines.push('', `### ${input.id} · ${input.title} (${LABEL[input.provider] ?? input.provider}${input.model ? ` · ${input.model}` : ''})`, truncate(input.output ?? '', INPUT_SHARE) || '(no output)');
    }
  }
  lines.push('', 'Finish with a short summary of what you produced and where.');
  return lines.join('\n');
}

/** What a peer-enabled step is told about messaging. */
export function peerRules(deps) {
  const who = deps.length ? `You may message the steps you depend on: ${deps.map((dep) => `${dep.id} (${dep.title}) as ${dep.callId}`).join(', ')}. Ask them only when their output is unclear.` : 'No other step is yours to message.';
  return `${who} Own only your step. Meow Ops does not read messages sent to parent: ask the owner through your native question or approval flow instead.`;
}

/** The planning prompt an agent answers with a JSON plan. */
export function planningPrompt({ brief, workspace, providers }) {
  const roster = providers.map((item) => `- ${item.id}: ${item.label}${item.role ? `, ${item.role}` : ''}`).join('\n');
  return [
    'Break the goal below into a plan for a team of local coding agents. Reply with one JSON object and nothing else.',
    'Shape: {"title": "short run title", "steps": [{"id": "s1", "title": "...", "kind": "execute|review|integrate", "instructions": "what this step must do", "dependsOn": [], "provider": "one id from the list"}]}',
    'Rules: 2 to 8 steps. Steps with no dependsOn run in parallel. A step may only depend on earlier steps. End with one integrate step when outputs must be combined. Prefer a review step by a different agent for risky work. Pick providers by fit from:',
    roster,
    '',
    `Goal: ${brief}`,
    `Workspace: ${workspace}`,
  ].join('\n');
}

/** The first JSON object in an agent's reply that normalises into a plan, or null. */
export function parsePlanReply(reply, base, options) {
  if (typeof reply !== 'string') return null;
  for (let start = reply.indexOf('{'); start !== -1; start = reply.indexOf('{', start + 1)) {
    for (let end = reply.lastIndexOf('}'); end > start; end = reply.lastIndexOf('}', end - 1)) {
      let candidate;
      try { candidate = JSON.parse(reply.slice(start, end + 1)); } catch { continue; }
      if (!candidate || !Array.isArray(candidate.steps)) continue;
      const fallback = options?.fallbackProviders ?? [];
      const provider = (value) => {
        const id = canonicalProvider(value);
        return id && (!fallback.length || fallback.includes(id)) ? id : fallback[0] ?? id;
      };
      try {
        return normalizePlan({
          ...base,
          title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title : base.title,
          steps: candidate.steps.map((step) => ({ ...step, provider: provider(step?.provider), kind: STEP_KINDS.includes(step?.kind) ? step.kind : 'execute', raw: false, model: null, effort: null })),
        }, options);
      } catch { /* keep looking */ }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

export function createOrchestrator({
  runsDir = defaultRunsDir(),
  swarmHome = autoswarmHome(),
  env = process.env,
  home = homedir(),
  exec = execAutoswarm,
  readReceipt = (callId) => readCallReceipt(swarmHome, callId),
  launcher = undefined,
  now = () => Date.now(),
  log = () => {},
} = {}) {
  const resolveRun = () => (launcher === undefined ? resolveLauncher({ env, home }) : launcher);
  let ticking = false;
  let timer = null;

  // One writer per run at a time: an approval click and the background tick
  // both load, change and save run.json, so they queue instead of racing.
  const locks = new Map();
  const withRun = (id, fn) => {
    const previous = locks.get(id) ?? Promise.resolve();
    const next = previous.then(fn);
    const tail = next.catch(() => {});
    locks.set(id, tail);
    void tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
    return next;
  };

  const dirFor = (id) => {
    if (!RUN_ID.test(id)) throw new PlanError('Unknown run.');
    return join(runsDir, id);
  };
  const load = (id) => {
    const path = join(dirFor(id), 'run.json');
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  };
  const save = (run) => {
    run.updatedAt = nowIso(now);
    const dir = dirFor(run.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = join(dir, `.run.${process.pid}.${randomBytes(3).toString('hex')}.tmp`);
    writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, join(dir, 'run.json'));
    return run;
  };
  const event = (run, type, detail = {}) => {
    run.events.push({ at: nowIso(now), type, ...detail });
    if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
  };
  const listIds = () => {
    try { return readdirSync(runsDir).filter((name) => RUN_ID.test(name)).sort().reverse(); } catch { return []; }
  };
  const call = (args, controller) => exec(args, { launcher: resolveRun().argv, home: swarmHome, controller, env });

  function newRun(plan, purpose = 'work') {
    return {
      schemaVersion: RUN_SCHEMA_VERSION,
      id: `run_${stamp(now)}_${randomBytes(3).toString('hex')}`,
      purpose,
      title: plan.title,
      brief: plan.brief,
      workspace: plan.workspace,
      maxParallel: plan.maxParallel,
      peers: plan.peers,
      tags: plan.tags ?? [],
      status: 'draft',
      controllerId: null,
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
      dispatchedAt: null,
      finishedAt: null,
      steps: plan.steps.map((step) => ({ ...step, status: 'draft', callId: null, nativeSessionId: null, startedAt: null, finishedAt: null, output: null, outputChars: 0, errorCode: null, error: null, pending: [], attempts: [] })),
      events: [],
      proposal: null,
    };
  }

  async function startStep(run, step, { followUp = null } = {}) {
    const attempt = step.attempts.length + 1;
    const promptDir = join(dirFor(run.id), 'prompts');
    mkdirSync(promptDir, { recursive: true, mode: 0o700 });
    const file = join(promptDir, `${step.id}-${attempt}.md`);
    writeFileSync(file, followUp ?? buildPrompt(run, step), { mode: 0o600 });
    let args;
    if (followUp) {
      args = ['resume', step.callId, '--input', file, '--background'];
    } else {
      args = ['run', '--agent', step.provider, '--cwd', run.workspace, '--input', file, '--background', '--no-parent'];
      if (step.model) args.push('--model', step.model);
      if (step.effort) args.push('--effort', step.effort);
      // Messaging is opt-in. A name, peers or rules make AutoSwarm teach the
      // child to message its parent, and Meow Ops does not read those, so a
      // plain run passes none. With peers on, grants go by the dependency's
      // call id, which still finds its conversation after a retry or follow-up.
      if (run.peers) {
        args.push('--name', attempt === 1 ? step.id : `${step.id}-r${attempt}`);
        const byId = new Map(run.steps.map((item) => [item.id, item]));
        const deps = step.dependsOn.map((id) => byId.get(id)).filter((dep) => dep?.callId);
        for (const dep of deps) args.push('--allow-peer', dep.callId);
        args.push('--communication-rules', peerRules(deps));
      }
    }
    step.status = 'starting';
    step.startedAt = nowIso(now);
    step.finishedAt = null;
    step.errorCode = null;
    step.error = null;
    step.pending = [];
    const result = await call(args, run.controllerId);
    if (!result.ok) {
      step.status = 'failed';
      step.errorCode = String(result.error?.code ?? 'dispatch_failed').slice(0, 60);
      step.error = String(result.error?.message ?? 'AutoSwarm refused the call.').slice(0, 400);
      step.finishedAt = nowIso(now);
      step.attempts.push({ attempt, kind: followUp ? 'follow-up' : 'run', callId: null, provider: step.provider, model: step.model, effort: step.effort, at: step.startedAt, status: 'failed', errorCode: step.errorCode });
      event(run, 'step-failed-to-start', { stepId: step.id, errorCode: step.errorCode });
      return;
    }
    const data = result.data ?? {};
    if (!run.controllerId && typeof data.controller_id === 'string') run.controllerId = data.controller_id;
    step.callId = typeof data.call_id === 'string' ? data.call_id : null;
    step.status = step.callId ? 'running' : 'failed';
    step.attempts.push({ attempt, kind: followUp ? 'follow-up' : 'run', callId: step.callId, provider: step.provider, model: step.model, effort: step.effort, at: step.startedAt, status: 'running' });
    event(run, followUp ? 'step-followed-up' : 'step-started', { stepId: step.id, callId: step.callId, provider: step.provider });
  }

  function refreshStep(run, step) {
    if (!step.callId || !ACTIVE.has(step.status)) return false;
    const receipt = readReceipt(step.callId);
    if (!receipt) return false;
    const before = `${step.status}|${step.pending.length}`;
    const attempt = step.attempts.find((item) => item.callId === step.callId);
    if (receipt.status === 'running') {
      step.pending = receipt.pending.map((item) => ({ requestId: item.requestId, kind: item.kind, title: item.title, createdAt: item.createdAt, ...(item.question ? { question: item.question } : {}) }));
      step.status = step.pending.length ? 'waiting' : 'running';
      step.nativeSessionId ??= receipt.nativeSessionId;
    } else {
      step.pending = [];
      step.finishedAt = receipt.finishedAt ?? nowIso(now);
      step.nativeSessionId = receipt.nativeSessionId ?? step.nativeSessionId;
      if (receipt.status === 'completed') {
        step.status = 'completed';
        step.output = truncate(receipt.content, OUTPUT_KEEP);
        step.outputChars = receipt.contentChars;
      } else {
        step.status = receipt.status === 'cancelled' ? 'cancelled' : receipt.status === 'interrupted' ? 'interrupted' : 'failed';
        step.errorCode = receipt.errorCode ?? step.status;
        step.error = receipt.error ?? null;
        if (receipt.content) { step.output = truncate(receipt.content, OUTPUT_KEEP); step.outputChars = receipt.contentChars; }
      }
      if (attempt) { attempt.status = step.status; attempt.errorCode = step.errorCode; }
      event(run, `step-${step.status}`, { stepId: step.id, callId: step.callId, ...(step.errorCode ? { errorCode: step.errorCode } : {}) });
    }
    return before !== `${step.status}|${step.pending.length}`;
  }

  function settle(run) {
    const byId = new Map(run.steps.map((step) => [step.id, step]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of run.steps) {
        if (step.status !== 'queued') continue;
        if (step.dependsOn.some((id) => FINAL_BAD.has(byId.get(id)?.status))) { step.status = 'blocked'; changed = true; event(run, 'step-blocked', { stepId: step.id }); }
      }
    }
    const before = run.status;
    const pendingWork = run.steps.some((step) => ACTIVE.has(step.status) || (step.status === 'queued' && !run.cancelRequested));
    if (run.steps.every((step) => step.status === 'completed')) run.status = 'completed';
    else if (pendingWork) run.status = 'running';
    else if (run.cancelRequested) run.status = 'cancelled';
    else run.status = 'needs-attention';
    if (run.status !== before) {
      run.finishedAt = ['completed', 'cancelled'].includes(run.status) ? nowIso(now) : null;
      event(run, `run-${run.status}`);
      if (run.purpose === 'plan' && run.status === 'completed') {
        run.proposal = parsePlanReply(run.steps[0]?.output, { title: run.title, brief: run.brief, workspace: run.workspace, maxParallel: 3 }, { home, fallbackProviders: run.availableProviders ?? [] });
        event(run, run.proposal ? 'plan-parsed' : 'plan-unparsed');
      }
    }
  }

  async function advance(run) {
    let changed = false;
    for (const step of run.steps) changed = refreshStep(run, step) || changed;
    const byId = new Map(run.steps.map((step) => [step.id, step]));
    const busy = () => run.steps.filter((step) => ACTIVE.has(step.status)).length;
    if (!run.cancelRequested) {
      for (const step of run.steps) {
        if (busy() >= run.maxParallel) break;
        if (step.status !== 'queued' || !step.dependsOn.every((id) => byId.get(id)?.status === 'completed')) continue;
        await startStep(run, step);
        changed = true;
      }
    }
    const before = run.status;
    settle(run);
    return changed || before !== run.status;
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      for (const id of listIds().slice(0, 40)) {
        await withRun(id, async () => {
          const run = load(id);
          if (!run || !['running', 'needs-attention'].includes(run.status)) return;
          if (run.status === 'needs-attention' && !run.steps.some((step) => ACTIVE.has(step.status) || step.status === 'queued')) return;
          if (await advance(run)) save(run);
        });
      }
    } catch (error) {
      log(`[swarm] tick failed: ${error.message}`);
    } finally {
      ticking = false;
    }
  }

  function summary(run) {
    const counts = {};
    for (const step of run.steps) counts[step.status] = (counts[step.status] ?? 0) + 1;
    return {
      id: run.id, title: run.title, purpose: run.purpose, status: run.status, workspace: run.workspace, tags: run.tags,
      createdAt: run.createdAt, updatedAt: run.updatedAt, dispatchedAt: run.dispatchedAt, finishedAt: run.finishedAt,
      steps: run.steps.length, counts, providers: [...new Set(run.steps.map((step) => step.provider))],
      waiting: run.steps.reduce((total, step) => total + step.pending.length, 0),
    };
  }

  const requireRun = (id) => {
    const run = load(id);
    if (!run) throw new PlanError('Unknown run.');
    return run;
  };
  const requireStep = (run, stepId) => {
    const step = run.steps.find((item) => item.id === stepId);
    if (!step) throw new PlanError('Unknown step.');
    return step;
  };

  return {
    capabilities() {
      const resolved = resolveRun();
      return { dispatch: Boolean(resolved.argv), launcher: resolved.source, error: resolved.error ?? null, home: swarmHome };
    },
    listRuns: () => listIds().slice(0, 50).map(load).filter(Boolean).map(summary),
    getRun: (id) => requireRun(id),
    saveDraft(plan, { id = null, available = null } = {}) {
      const normalised = normalizePlan(plan, { home, available });
      if (id) {
        const existing = requireRun(id);
        if (existing.status !== 'draft') throw new PlanError('Only a draft can be edited. Duplicate the run to change it.');
        const next = newRun(normalised);
        return save({ ...next, id: existing.id, createdAt: existing.createdAt, events: existing.events });
      }
      const run = newRun(normalised);
      event(run, 'run-drafted');
      return save(run);
    },
    dispatch: (id) => withRun(id, async () => {
      const run = requireRun(id);
      if (run.status !== 'draft') throw new PlanError('This run was already dispatched.');
      if (!resolveRun().argv) throw new PlanError(resolveRun().error ?? 'AutoSwarm is not installed where the helper can run it.');
      run.status = 'running';
      run.dispatchedAt = nowIso(now);
      for (const step of run.steps) step.status = 'queued';
      event(run, 'run-dispatched', { steps: run.steps.length });
      await advance(run);
      return save(run);
    }),
    async draftPlan({ brief, workspace, provider, model = null, effort = null, providers = [] }) {
      const plan = normalizePlan({
        title: 'Draft a plan',
        brief,
        workspace,
        maxParallel: 1,
        steps: [{ id: 'plan', title: 'Break the goal into steps', kind: 'execute', provider, model, effort, raw: true, instructions: planningPrompt({ brief: text(brief, 8000), workspace, providers }) }],
      }, { home });
      if (!plan.brief) throw new PlanError('Describe the goal first.');
      const run = newRun(plan, 'plan');
      run.availableProviders = providers.map((item) => item.id).filter((id) => canonicalProvider(id));
      run.status = 'running';
      run.dispatchedAt = nowIso(now);
      run.steps[0].status = 'queued';
      event(run, 'plan-requested', { provider });
      await advance(run);
      return save(run);
    },
    cancelRun: (id) => withRun(id, async () => {
      const run = requireRun(id);
      run.cancelRequested = true;
      for (const step of run.steps) {
        if (step.status === 'queued' || step.status === 'draft') step.status = 'cancelled';
        else if (ACTIVE.has(step.status) && step.callId) {
          const result = await call(['cancel', step.callId], run.controllerId);
          event(run, result.ok ? 'step-cancel-requested' : 'step-cancel-failed', { stepId: step.id });
        }
      }
      event(run, 'run-cancel-requested');
      await advance(run);
      return save(run);
    }),
    cancelStep: (id, stepId) => withRun(id, async () => {
      const run = requireRun(id);
      const step = requireStep(run, stepId);
      if (step.status === 'queued') step.status = 'cancelled';
      else if (ACTIVE.has(step.status) && step.callId) {
        const result = await call(['cancel', step.callId], run.controllerId);
        if (!result.ok) throw new PlanError(result.error?.message ?? 'AutoSwarm could not cancel this step.');
        event(run, 'step-cancel-requested', { stepId });
      } else throw new PlanError('Only a queued or running step can be cancelled.');
      await advance(run);
      return save(run);
    }),
    retryStep: (id, stepId, { provider, model, effort } = {}) => withRun(id, async () => {
      const run = requireRun(id);
      const step = requireStep(run, stepId);
      if (!['failed', 'cancelled', 'interrupted'].includes(step.status)) throw new PlanError('Only a failed, cancelled or interrupted step can be retried. A running step may still be doing the work.');
      const nextProvider = provider ? canonicalProvider(provider) : step.provider;
      if (!nextProvider) throw new PlanError('Choose a harness for the retry.');
      step.provider = nextProvider;
      step.model = model === undefined ? step.model : nativeValue(model, 'Model');
      step.effort = effort === undefined ? step.effort : nativeValue(effort, 'Effort');
      step.status = 'queued';
      step.callId = null;
      step.nativeSessionId = null;
      run.cancelRequested = false;
      for (const other of run.steps) if (other.status === 'blocked') other.status = 'queued';
      event(run, 'step-retry', { stepId, provider: nextProvider });
      await advance(run);
      return save(run);
    }),
    followUp: (id, stepId, message) => withRun(id, async () => {
      const run = requireRun(id);
      const step = requireStep(run, stepId);
      const body = text(message, 8000);
      if (!body) throw new PlanError('Write the follow-up first.');
      if (!step.callId || ACTIVE.has(step.status) || !['completed', 'failed', 'interrupted'].includes(step.status)) throw new PlanError('Follow up after the step has finished.');
      if (!step.nativeSessionId) throw new PlanError('This step has no native session to resume.');
      await startStep(run, step, { followUp: body });
      if (run.status !== 'running' && ACTIVE.has(step.status)) run.status = 'running';
      return save(run);
    }),
    decide: (id, stepId, requestId, allow) => withRun(id, async () => {
      const run = requireRun(id);
      const step = requireStep(run, stepId);
      const pending = REQUEST_ID.test(String(requestId)) ? step.pending.find((item) => item.requestId === requestId) : null;
      if (!pending) throw new PlanError('That approval is no longer pending.');
      if (pending.kind === 'question') throw new PlanError('This is a question, not a permission. Answer it instead.');
      const result = await call([allow ? 'approve' : 'deny', step.callId, requestId, '--by', 'user'], run.controllerId);
      if (!result.ok) throw new PlanError(result.error?.message ?? 'AutoSwarm could not record the decision.');
      step.pending = step.pending.filter((item) => item.requestId !== requestId);
      if (step.status === 'waiting' && !step.pending.length) step.status = 'running';
      event(run, allow ? 'approval-allowed' : 'approval-denied', { stepId, requestId });
      return save(run);
    }),
    // Relay your answer to a native question. AutoSwarm validates it against the
    // original request, so a malformed answer is refused before it reaches the agent.
    answer: (id, stepId, requestId, response) => withRun(id, async () => {
      const run = requireRun(id);
      const step = requireStep(run, stepId);
      const pending = REQUEST_ID.test(String(requestId)) ? step.pending.find((item) => item.requestId === requestId) : null;
      if (!pending || pending.kind !== 'question') throw new PlanError('That question is no longer pending.');
      if (!response || typeof response !== 'object' || Array.isArray(response)) throw new PlanError('An answer is a JSON object.');
      const body = JSON.stringify(response);
      if (body.length > 20_000) throw new PlanError('That answer is too long.');
      const dir = join(dirFor(run.id), 'prompts');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `${step.id}-answer-${randomBytes(4).toString('hex')}.json`);
      writeFileSync(file, body, { mode: 0o600 });
      const result = await call(['answer', step.callId, requestId, '--input', file, '--by', 'user'], run.controllerId);
      if (!result.ok) throw new PlanError(result.error?.message ?? 'AutoSwarm could not deliver the answer.');
      step.pending = step.pending.filter((item) => item.requestId !== requestId);
      if (step.status === 'waiting' && !step.pending.length) step.status = 'running';
      event(run, 'question-answered', { stepId, requestId });
      return save(run);
    }),
    tick,
    start(intervalMs = 1500) {
      if (timer) return;
      timer = setInterval(() => { void tick(); }, intervalMs);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
