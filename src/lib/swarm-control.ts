// Swarm control panel: the page-side contract with sync/swarm-orchestrator.mjs.
//
// Types for plans and runs, a client that only ever talks to the loopback
// helper (and fetches a one-use owner nonce before anything that makes
// AutoSwarm act), and the pure helpers the panel draws from: breakdown
// templates, DAG layout, command previews and status labels. No imports: the
// tests transpile this file on its own.

export type StepKind = 'execute' | 'review' | 'integrate';
export type StepStatus = 'draft' | 'queued' | 'starting' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'blocked';
export type RunStatus = 'draft' | 'running' | 'needs-attention' | 'completed' | 'cancelled';
export type ToneName = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger' | 'info';

export interface PlanStep {
  id: string;
  title: string;
  kind: StepKind;
  instructions: string;
  dependsOn: string[];
  provider: string;
  model: string | null;
  effort: string | null;
  raw: boolean;
}

export interface PlanDraft {
  title: string;
  brief: string;
  workspace: string;
  maxParallel: number;
  peers: boolean;
  tags: string[];
  steps: PlanStep[];
}

export type QuestionFormat = 'claude-question' | 'codebuddy-question' | 'codex-question' | 'cursor-question' | 'opencode-question' | 'muse-question' | 'acp-question' | 'codex-async-question' | 'cursor-plan' | 'elicitation' | 'unknown';
export interface QuestionOption { id: string; label: string; description?: string }
export interface NativeQuestion { key: string; text: string | null; multi: boolean; custom?: boolean; options: QuestionOption[] }
export interface QuestionDetail { format: QuestionFormat; help: string | null; userRequired: boolean; questions: NativeQuestion[] }
export interface PendingDecision { requestId: string; kind: 'permission' | 'question'; title: string; createdAt: string | null; question?: QuestionDetail }
export interface StepAttempt { attempt: number; kind: 'run' | 'follow-up'; callId: string | null; provider: string; model: string | null; effort: string | null; at: string; status: string; errorCode?: string | null }

export interface RunStep extends PlanStep {
  status: StepStatus;
  callId: string | null;
  nativeSessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  output: string | null;
  outputChars: number;
  errorCode: string | null;
  error: string | null;
  pending: PendingDecision[];
  attempts: StepAttempt[];
}

export interface RunEvent { at: string; type: string; stepId?: string; callId?: string; errorCode?: string; provider?: string }

export interface SwarmRun {
  schemaVersion: 1;
  id: string;
  purpose: 'work' | 'plan';
  title: string;
  brief: string;
  workspace: string;
  maxParallel: number;
  peers: boolean;
  tags: string[];
  status: RunStatus;
  controllerId: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  finishedAt: string | null;
  steps: RunStep[];
  events: RunEvent[];
  proposal: PlanDraft | null;
}

export interface RunSummary {
  id: string; title: string; purpose: 'work' | 'plan'; status: RunStatus; workspace: string; tags: string[];
  createdAt: string; updatedAt: string; dispatchedAt: string | null; finishedAt: string | null;
  steps: number; counts: Partial<Record<StepStatus, number>>; providers: string[]; waiting: number;
}

// ---------------------------------------------------------------------------
// Client.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function isSwarmRun(value: unknown): value is SwarmRun {
  return record(value) && value.schemaVersion === 1 && typeof value.id === 'string' && typeof value.status === 'string'
    && Array.isArray(value.steps) && value.steps.every((step) => record(step) && typeof step.id === 'string' && typeof step.status === 'string' && typeof step.provider === 'string' && Array.isArray(step.dependsOn))
    && Array.isArray(value.events);
}

interface ClientOptions { hostname?: string; baseUrl?: string; fetcher?: typeof fetch }

export function createSwarmControlClient(options: ClientOptions = {}) {
  const hostname = options.hostname ?? (typeof window === 'undefined' ? '' : window.location.hostname);
  const fetcher = options.fetcher ?? fetch;
  const base = () => {
    if (!LOCAL_HOSTS.has(hostname)) throw new Error('Swarm control runs in the local dashboard only.');
    let url: URL;
    try { url = new URL(options.baseUrl || import.meta.env?.VITE_LOCAL_SYNC_URL || 'http://127.0.0.1:7337'); }
    catch { throw new Error('Swarm control needs a valid local helper address.'); }
    if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Swarm control needs a loopback local helper address.');
    return url;
  };
  async function request(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
    const url = new URL(path, base());
    if (!init.body) url.searchParams.set('t', String(Date.now()));
    const timeout = AbortSignal.timeout(init.method === 'POST' ? 90_000 : 10_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetcher(url, {
        method: init.method ?? 'GET',
        headers: { 'x-meow-ops-local': '1', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        mode: 'cors', redirect: 'error', cache: 'no-store', signal,
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new Error(signal.aborted && !init.signal?.aborted ? 'The local helper took too long to answer.' : 'Swarm control could not reach the local helper.');
    }
    if (response.status === 404) throw new Error('This helper has no swarm control yet. Restart it with the updated app.');
    let data: unknown;
    try { data = await response.json(); } catch { throw new Error('The local helper returned an invalid response.'); }
    if (!response.ok || !record(data) || data.ok === false) {
      const message = record(data) && typeof data.error === 'string' ? data.error.replace(/^\[[\w-]+\]\s*/, '') : 'The local helper refused this request.';
      throw new Error(message);
    }
    return data;
  }
  const run = (data: Record<string, unknown>): SwarmRun => {
    if (!isSwarmRun(data.run)) throw new Error('The run came back in a shape this page cannot verify.');
    return data.run;
  };
  async function owner(path: string, body: Record<string, unknown> = {}) {
    const nonce = await request('/swarm/nonce');
    if (typeof nonce.nonce !== 'string') throw new Error('The helper did not issue an owner nonce.');
    return run(await request(path, { method: 'POST', body: { ...body, nonce: nonce.nonce } }));
  }
  return {
    listRuns: async (signal?: AbortSignal): Promise<RunSummary[]> => {
      const data = await request('/swarm/runs', signal ? { signal } : {});
      return Array.isArray(data.runs) ? data.runs as RunSummary[] : [];
    },
    getRun: async (id: string, signal?: AbortSignal) => run(await request(`/swarm/runs/${encodeURIComponent(id)}`, signal ? { signal } : {})),
    saveDraft: async (plan: PlanDraft, id: string | null = null) => run(await request('/swarm/runs', { method: 'POST', body: { plan, ...(id ? { id } : {}) } })),
    dispatch: (id: string) => owner(`/swarm/runs/${encodeURIComponent(id)}/dispatch`),
    cancelRun: (id: string) => owner(`/swarm/runs/${encodeURIComponent(id)}/cancel`),
    cancelStep: (id: string, stepId: string) => owner(`/swarm/runs/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}/cancel`),
    retryStep: (id: string, stepId: string, choice: { provider: string; model: string | null; effort: string | null }) => owner(`/swarm/runs/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}/retry`, choice),
    followUp: (id: string, stepId: string, message: string) => owner(`/swarm/runs/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}/follow-up`, { message }),
    decide: (id: string, stepId: string, requestId: string, decision: 'allow' | 'deny') => owner(`/swarm/runs/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}/decide`, { requestId, decision }),
    answer: (id: string, stepId: string, requestId: string, response: Record<string, unknown>) => owner(`/swarm/runs/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}/answer`, { requestId, response }),
    draftPlan: (input: { brief: string; workspace: string; provider: string; model: string | null; effort: string | null }) => owner('/swarm/plan', input),
  };
}

export const swarmControl = () => createSwarmControlClient();

// ---------------------------------------------------------------------------
// Breakdown templates. Deterministic starting points you then edit.

export type TemplateId = 'blank' | 'fan-out' | 'build-review' | 'compare' | 'research';

export const TEMPLATES: readonly { id: TemplateId; label: string; hint: string }[] = [
  { id: 'fan-out', label: 'Fan-out + stitch', hint: 'Independent parts in parallel, one integrator combines them.' },
  { id: 'build-review', label: 'Build, review, fix', hint: 'One builds, a different harness reviews, the builder fixes.' },
  { id: 'compare', label: 'Compare harnesses', hint: 'Same task on several harnesses or models, then a judge.' },
  { id: 'research', label: 'Research, draft, verify', hint: 'Gather facts, write, then check against sources.' },
  { id: 'blank', label: 'Blank', hint: 'One step. Add the rest yourself.' },
];

const step = (id: string, provider: string, title: string, instructions: string, extra: Partial<PlanStep> = {}): PlanStep => ({
  id, title, kind: 'execute', instructions, dependsOn: [], provider, model: null, effort: null, raw: false, ...extra,
});

/** A plan skeleton for the goal. `providers` are found harness ids, best first. */
export function planTemplate(template: TemplateId, providers: readonly string[]): PlanStep[] {
  const pick = (index: number) => providers.length ? providers[index % providers.length] ?? 'codex' : 'codex';
  switch (template) {
    case 'fan-out':
      return [
        step('s1', pick(0), 'Part one', 'Do the first independent part of the goal.'),
        step('s2', pick(1), 'Part two', 'Do the second independent part of the goal.'),
        step('s3', pick(2), 'Part three', 'Do the third independent part of the goal.'),
        step('s4', pick(0), 'Stitch', 'Combine the three parts into one deliverable and check they fit together.', { kind: 'integrate', dependsOn: ['s1', 's2', 's3'] }),
      ];
    case 'build-review':
      return [
        step('s1', pick(0), 'Build', 'Implement the goal with tests.'),
        step('s2', pick(1), 'Review', 'Review the change for bugs, security issues and missing tests. Do not edit files.', { kind: 'review', dependsOn: ['s1'] }),
        step('s3', pick(0), 'Fix', 'Address every review finding, then summarise what changed.', { dependsOn: ['s1', 's2'] }),
      ];
    case 'compare': {
      const contenders = [0, 1, 2].map((index) => step(`s${index + 1}`, pick(index), `Attempt ${index + 1}`, 'Solve the goal on your own. Do not look at other attempts.'));
      return [...contenders, step('s4', pick(3), 'Judge', 'Compare the attempts on correctness, clarity and risk. Pick one, say why, and list what to borrow from the others.', { kind: 'review', dependsOn: contenders.map((item) => item.id) })];
    }
    case 'research':
      return [
        step('s1', pick(0), 'Research', 'Collect the facts the goal needs, with sources.'),
        step('s2', pick(1), 'Draft', 'Write the deliverable from the research.', { dependsOn: ['s1'] }),
        step('s3', pick(2), 'Verify', 'Check every claim in the draft against the research. List anything unsupported.', { kind: 'review', dependsOn: ['s1', 's2'] }),
      ];
    default:
      return [step('s1', pick(0), 'Do the work', 'Describe what this step should do.')];
  }
}

export function nextStepId(steps: readonly PlanStep[]): string {
  const used = new Set(steps.map((item) => item.id));
  for (let index = steps.length + 1; ; index += 1) if (!used.has(`s${index}`)) return `s${index}`;
}

/** Client-side checks that mirror the helper's, so problems show before you press Dispatch. */
export function planProblems(plan: PlanDraft): string[] {
  const problems: string[] = [];
  if (!plan.workspace.trim()) problems.push('Choose a workspace folder.');
  if (!plan.steps.length) problems.push('Add at least one step.');
  const seen = new Set<string>();
  plan.steps.forEach((item, index) => {
    const label = `Step ${item.id || index + 1}`;
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(item.id)) problems.push(`${label}: ids use lowercase letters, digits and dashes.`);
    if (seen.has(item.id)) problems.push(`${label}: the id is used twice.`);
    if (!item.provider) problems.push(`${label}: choose a harness.`);
    if (!item.instructions.trim()) problems.push(`${label}: write what it should do.`);
    for (const dep of item.dependsOn) if (!seen.has(dep)) problems.push(`${label} depends on ${dep}, which must come earlier.`);
    for (const [field, value] of [['model', item.model], ['effort', item.effort]] as const) {
      if (value && !/^[A-Za-z0-9][\w.:/@[\]=,+-]{0,79}$/.test(value)) problems.push(`${label}: the ${field} must be a native id without spaces.`);
    }
    seen.add(item.id);
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Pipeline layout: columns by dependency depth, rows in plan order.

export interface PipelineNode { id: string; level: number; row: number }
export interface PipelineLayout { nodes: PipelineNode[]; edges: { from: string; to: string }[]; levels: number; rows: number }

export function pipelineLayout(steps: readonly Pick<PlanStep, 'id' | 'dependsOn'>[]): PipelineLayout {
  const level = new Map<string, number>();
  for (const item of steps) {
    const depth = item.dependsOn.reduce((max, dep) => Math.max(max, (level.get(dep) ?? -1) + 1), 0);
    level.set(item.id, depth);
  }
  const rowsPerLevel = new Map<number, number>();
  const nodes = steps.map((item) => {
    const depth = level.get(item.id) ?? 0;
    const row = rowsPerLevel.get(depth) ?? 0;
    rowsPerLevel.set(depth, row + 1);
    return { id: item.id, level: depth, row };
  });
  const known = new Set(steps.map((item) => item.id));
  return {
    nodes,
    edges: steps.flatMap((item) => item.dependsOn.filter((dep) => known.has(dep)).map((dep) => ({ from: dep, to: item.id }))),
    levels: Math.max(0, ...nodes.map((node) => node.level)) + (nodes.length ? 1 : 0),
    rows: Math.max(0, ...rowsPerLevel.values()),
  };
}

// ---------------------------------------------------------------------------
// Words and commands.

export const STEP_STATUS_META: Readonly<Record<StepStatus, { label: string; tone: ToneName }>> = {
  draft: { label: 'Draft', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'neutral' },
  starting: { label: 'Starting', tone: 'accent' },
  running: { label: 'Running', tone: 'accent' },
  waiting: { label: 'Waiting on you', tone: 'warning' },
  completed: { label: 'Done', tone: 'positive' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  interrupted: { label: 'Interrupted', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'warning' },
};

export const RUN_STATUS_META: Readonly<Record<RunStatus, { label: string; tone: ToneName }>> = {
  draft: { label: 'Draft', tone: 'neutral' },
  running: { label: 'Running', tone: 'accent' },
  'needs-attention': { label: 'Needs you', tone: 'warning' },
  completed: { label: 'Done', tone: 'positive' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const KIND_LABEL: Readonly<Record<StepKind, string>> = { execute: 'Execute', review: 'Review', integrate: 'Integrate' };

function word(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,~-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The AutoSwarm command the helper will run for a step, shown before dispatch. */
export function stepCommand(item: Pick<PlanStep, 'id' | 'provider' | 'model' | 'effort' | 'dependsOn'>, workspace: string, peers = false): string {
  return ['autoswarm run --agent', word(item.provider), '--cwd', word(workspace || '.'),
    ...(item.model ? ['--model', word(item.model)] : []), ...(item.effort ? ['--effort', word(item.effort)] : []),
    '--background --no-parent --input', `prompts/${item.id}-1.md`,
    // With peers on, each step is named and may message the calls it depends on.
    ...(peers ? ['--name', item.id, ...item.dependsOn.flatMap((dep) => ['--allow-peer', `<${dep} call>`])] : [])].join(' ');
}

/** The step whose output answers the run: the last integrate or review step, else the last step. */
export function finalStep<T extends Pick<PlanStep, 'id' | 'kind' | 'dependsOn'>>(steps: readonly T[]): T | null {
  const dependedOn = new Set(steps.flatMap((item) => item.dependsOn));
  const sinks = steps.filter((item) => !dependedOn.has(item.id));
  return [...sinks].reverse().find((item) => item.kind !== 'execute') ?? sinks[sinks.length - 1] ?? null;
}

export function elapsed(fromIso: string | null, toIso: string | null, now: number): string {
  if (!fromIso) return 'Not started';
  const start = Date.parse(fromIso);
  const end = toIso ? Date.parse(toIso) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Unavailable';
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export const emptyPlan = (workspace = ''): PlanDraft => ({ title: '', brief: '', workspace, maxParallel: 3, peers: false, tags: [], steps: [] });

// ---------------------------------------------------------------------------
// Native questions. Each harness asks in its own format; these build the reply
// AutoSwarm expects. AutoSwarm validates it again before the agent sees it.

export interface AnswerDraft { picks: Record<string, string[]>; text: Record<string, string> }
export const emptyAnswer = (): AnswerDraft => ({ picks: {}, text: {} });

/** Formats the panel can answer with choices and short text; others get a JSON reply. */
export const GUIDED_FORMATS: readonly QuestionFormat[] = ['claude-question', 'codebuddy-question', 'codex-question', 'cursor-question', 'opencode-question', 'muse-question', 'acp-question', 'codex-async-question'];

export function allowsText(format: QuestionFormat, question: NativeQuestion): boolean {
  if (format === 'cursor-question' || format === 'acp-question') return false;
  if (format === 'opencode-question') return question.custom !== false;
  return GUIDED_FORMATS.includes(format);
}

export function togglePick(draft: AnswerDraft, question: NativeQuestion, optionId: string): AnswerDraft {
  const current = draft.picks[question.key] ?? [];
  const next = question.multi
    ? (current.includes(optionId) ? current.filter((item) => item !== optionId) : [...current, optionId])
    : (current[0] === optionId ? [] : [optionId]);
  return { ...draft, picks: { ...draft.picks, [question.key]: next } };
}

/** The reply for a guided answer, or null until every question has an answer. */
export function answerPayload(detail: QuestionDetail, draft: AnswerDraft): Record<string, unknown> | null {
  const { format, questions } = detail;
  if (!GUIDED_FORMATS.includes(format) || questions.length === 0) return null;
  const typed = (question: NativeQuestion) => (allowsText(format, question) ? (draft.text[question.key] ?? '').trim() : '');
  const chosen = (question: NativeQuestion): string[] => {
    const text = typed(question);
    return text ? [text] : (draft.picks[question.key] ?? []).filter(Boolean);
  };
  if (questions.some((question) => chosen(question).length === 0)) return null;
  const first = (question: NativeQuestion) => chosen(question)[0] ?? '';
  switch (format) {
    case 'claude-question':
    case 'codebuddy-question':
      return { answers: Object.fromEntries(questions.map((question) => [question.key, question.multi && !typed(question) ? chosen(question) : first(question)])) };
    case 'codex-question':
      return { answers: Object.fromEntries(questions.map((question) => [question.key, { answers: chosen(question) }])) };
    case 'cursor-question':
      return { outcome: 'answered', answers: questions.map((question) => ({ questionId: question.key, selectedOptionIds: chosen(question) })) };
    case 'opencode-question':
      return { answers: questions.map((question) => chosen(question)) };
    case 'muse-question':
      return {
        action: 'answer',
        answers: questions.map((question) => (typed(question) ? { questionId: question.key, freeText: typed(question) }
          : question.multi ? { questionId: question.key, selectedLabels: chosen(question) } : { questionId: question.key, selectedLabel: first(question) })),
      };
    case 'acp-question':
      return { optionId: first(questions[0] as NativeQuestion) };
    case 'codex-async-question':
      return { text: first(questions[0] as NativeQuestion) };
    default:
      return null;
  }
}

/** The reply that declines a question, where the format has one. */
export function declinePayload(detail: QuestionDetail): Record<string, unknown> | null {
  switch (detail.format) {
    case 'claude-question':
    case 'codebuddy-question':
    case 'opencode-question':
    case 'muse-question':
    case 'acp-question':
    case 'elicitation':
      return { action: 'cancel' };
    case 'cursor-question':
    case 'cursor-plan':
      return { outcome: 'cancelled' };
    case 'codex-question':
      return { answers: Object.fromEntries(detail.questions.map((question) => [question.key, { answers: [] }])) };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// What to do about the AutoSwarm errors people actually hit. The native message
// stays on screen; this only adds the next move.

const ERROR_HINTS: Readonly<Record<string, string>> = {
  native_auth_required: 'Sign in to {harness} in its own app or CLI, then retry. Or reassign the step to a harness that is signed in.',
  unsupported_effort: '{harness} has no such effort control for this model. Clear effort, or pick one of the native choices listed, then retry.',
  invalid_model: '{harness} does not know that model id. Use a native id it lists, or clear the model to use its default.',
  native_selection_rejected: '{harness} refused the model or effort. Clear them to use its defaults, then retry.',
  provider_unavailable: 'AutoSwarm cannot start {harness} on this machine. Check it is installed for the helper, or reassign the step.',
  native_start_failed: '{harness} did not start. Run autoswarm doctor for it, or reassign the step.',
  runner_start_failed: 'AutoSwarm could not start its runner. Check the AutoSwarm install, then retry.',
  workspace_not_found: 'The workspace folder is gone. Duplicate the run with a folder that exists.',
  session_busy: 'That conversation is still busy. Wait for it to finish, then follow up again.',
  session_unavailable: '{harness} returned no native session, so this step cannot be resumed. Retry it as a new call instead.',
  autoswarm_unavailable: 'The helper cannot find AutoSwarm. Set AUTOSWARM_BIN or install AutoSwarm on the helper PATH.',
  timeout: 'AutoSwarm did not answer in time. Check the helper log, then retry.',
};

/** A one-line next step for a known AutoSwarm error code, or null. */
export function errorHint(code: string | null | undefined, harness: string): string | null {
  const hint = code ? ERROR_HINTS[code] : undefined;
  return hint ? hint.replaceAll('{harness}', harness) : null;
}
