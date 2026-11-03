// Today · Swarm data boundary.
//
// The local helper reads AutoSwarm receipts (sync/swarm-status.mjs). This
// module validates them at the edge, refuses to call the helper from the
// hosted shell, and holds the labelled sample the hosted demo draws instead.
// It also owns the pure layout and command helpers the page uses, so they can
// be tested without a browser. Keep it free of imports: the tests transpile it
// on its own.

export type CatClass = 'architect' | 'builder' | 'commander' | 'detective' | 'guardian' | 'storyteller' | 'ghost';
export type SwarmState = 'waiting' | 'running' | 'failing' | 'verified' | 'replied' | 'found' | 'off';
export type SwarmEvidence = 'verified' | 'observed' | 'pending' | 'failed' | 'none' | 'unsupported';
export type SwarmCallStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';
export type SwarmCallKind = 'probe' | 'probe-resume' | 'resume' | 'task';
export type BadgeToneName = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger' | 'info';

export interface SwarmProbe {
  at: string | null;
  status: 'verified' | 'running' | 'reply-only' | 'resume-failed' | 'failed';
  initialCallId: string;
  resumeCallId: string | null;
  errorCode: string | null;
}

export interface SwarmCallCounts {
  total: number; last7d: number; running: number; completed: number; failed: number; cancelled: number; interrupted: number;
}

export interface SwarmModel {
  id: string;
  /** Where the evidence came from: config, sessions, autoswarm, roster. */
  sources: string[];
  default: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
  accepted: number;
  rejected: number;
  effortRejected: number;
  new: boolean;
}

export interface SwarmModelCatalog {
  effort: { supported: boolean | 'unknown'; evidence: string | null };
  models: SwarmModel[];
}

export interface SwarmControlCapability { dispatch: boolean; launcher: string | null; error: string | null; home: string; enabled: boolean }

export interface SwarmProvider {
  id: string;
  label: string;
  name: string;
  role: string | null;
  cat: CatClass;
  note: string | null;
  model: string | null;
  effort: string | null;
  hidden: boolean;
  meowSource: string | null;
  command: { binary: string; overridden: boolean; executable: 'found' | 'not-found' | 'unknown' };
  hostInstalled: boolean;
  calls: SwarmCallCounts;
  pendingApprovals: number;
  lastCallAt: string | null;
  lastStatus: SwarmCallStatus | null;
  lastErrorCode: string | null;
  evidence: { probe: SwarmProbe | null; reply: SwarmEvidence; resume: SwarmEvidence; approvalRelay: SwarmEvidence };
  /** Absent on helpers older than the model catalog. */
  models?: SwarmModelCatalog;
  state: SwarmState;
}

export interface SwarmExtra {
  id: string; name: string; role: string | null; cat: CatClass; where: string | null; note: string | null; meowSource: string | null;
}

export interface SwarmCall {
  id: string;
  provider: string;
  status: SwarmCallStatus;
  kind: SwarmCallKind;
  createdAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  workspaceName: string | null;
  snippet: string | null;
  errorCode: string | null;
  model: string | null;
  effort: string | null;
  resumes: string | null;
  approvals: number;
}

export interface SwarmApproval {
  callId: string; requestId: string; provider: string; kind: 'permission' | 'question'; createdAt: string | null; title: string;
}

export interface SwarmSnapshot {
  ok: true;
  schemaVersion: 1;
  scope: 'local-only' | 'sample';
  generatedAt: string;
  autoswarm: {
    home: string;
    exists: boolean;
    config: string;
    delegateApprovals: { value: boolean; source: 'config' | 'default' };
    entryPoints: { path: string; hosts: string[]; installed: boolean }[];
  };
  overlay: { path: string; loaded: boolean; error: string | null };
  owner: { name: string | null; title: string | null } | null;
  workspace: string | null;
  workspaceSource: 'swarm.json' | 'latest-call' | null;
  hideUnconfigured: boolean;
  providers: SwarmProvider[];
  extras: SwarmExtra[];
  calls: SwarmCall[];
  approvals: SwarmApproval[];
  totals: { found: number; verified: number; visible: number; running: number; waiting: number; calls7d: number; failed7d: number; callsScanned: number };
  coverage: { callDirectories: number; scanned: number; truncated: boolean; unreadable: number };
  /** Absent on helpers older than Swarm control. */
  control?: SwarmControlCapability;
}

// ---------------------------------------------------------------------------
// Validation at the API edge.

const CATS: readonly string[] = ['architect', 'builder', 'commander', 'detective', 'guardian', 'storyteller', 'ghost'];
const STATES: readonly string[] = ['waiting', 'running', 'failing', 'verified', 'replied', 'found', 'off'];
const EVIDENCE: readonly string[] = ['verified', 'observed', 'pending', 'failed', 'none', 'unsupported'];
const CALL_STATUSES: readonly string[] = ['running', 'completed', 'failed', 'cancelled', 'interrupted', 'unknown'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string';
const maybeText = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isProvider(value: unknown): value is SwarmProvider {
  if (!record(value) || !text(value.id) || !text(value.label) || !text(value.name) || !CATS.includes(String(value.cat)) || !STATES.includes(String(value.state))) return false;
  if (!maybeText(value.role) || !maybeText(value.note) || !maybeText(value.model) || !maybeText(value.effort) || typeof value.hidden !== 'boolean') return false;
  const calls = value.calls;
  if (!record(calls) || !['total', 'last7d', 'running', 'completed', 'failed', 'cancelled', 'interrupted'].every((key) => count(calls[key]))) return false;
  const evidence = value.evidence;
  if (!record(evidence) || !['reply', 'resume', 'approvalRelay'].every((key) => EVIDENCE.includes(String(evidence[key])))) return false;
  const command = value.command;
  return record(command) && text(command.binary) && ['found', 'not-found', 'unknown'].includes(String(command.executable)) && count(value.pendingApprovals);
}

function isCall(value: unknown): value is SwarmCall {
  return record(value) && text(value.id) && text(value.provider) && CALL_STATUSES.includes(String(value.status))
    && ['probe', 'probe-resume', 'resume', 'task'].includes(String(value.kind)) && maybeText(value.createdAt) && maybeText(value.snippet);
}

export function isSwarmSnapshot(value: unknown): value is SwarmSnapshot {
  if (!record(value) || value.ok !== true || value.schemaVersion !== 1 || !['local-only', 'sample'].includes(String(value.scope)) || !text(value.generatedAt)) return false;
  const autoswarm = value.autoswarm;
  if (!record(autoswarm) || !text(autoswarm.home) || typeof autoswarm.exists !== 'boolean' || !Array.isArray(autoswarm.entryPoints)) return false;
  if (!record(value.overlay) || !Array.isArray(value.providers) || !value.providers.every(isProvider)) return false;
  if (!Array.isArray(value.calls) || !value.calls.every(isCall) || !Array.isArray(value.approvals) || !Array.isArray(value.extras)) return false;
  const totals = value.totals;
  return record(totals) && ['found', 'verified', 'running', 'waiting', 'calls7d', 'failed7d'].every((key) => count(totals[key])) && record(value.coverage);
}

export function isLocalSwarmSurface(hostname = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return LOCAL_HOSTS.has(hostname);
}

interface SwarmClientOptions { hostname?: string; baseUrl?: string; fetcher?: typeof fetch }

export function createSwarmClient(options: SwarmClientOptions = {}) {
  const hostname = options.hostname ?? (typeof window === 'undefined' ? '' : window.location.hostname);
  const fetcher = options.fetcher ?? fetch;
  return {
    async read(signal?: AbortSignal): Promise<SwarmSnapshot> {
      if (!isLocalSwarmSurface(hostname)) throw new Error('AutoSwarm receipts are available in the local dashboard only.');
      let base: URL;
      try { base = new URL(options.baseUrl || import.meta.env?.VITE_LOCAL_SYNC_URL || 'http://127.0.0.1:7337'); }
      catch { throw new Error('The swarm view requires a valid local helper address.'); }
      if (base.protocol !== 'http:' || !LOCAL_HOSTS.has(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
        throw new Error('The swarm view requires a loopback local helper address.');
      }
      const url = new URL('/swarm/status', base);
      url.searchParams.set('t', String(Date.now()));
      const timeout = AbortSignal.timeout(8_000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await fetcher(url, { method: 'GET', headers: { 'x-meow-ops-local': '1' }, mode: 'cors', redirect: 'error', cache: 'no-store', signal: combined });
      } catch {
        if (signal?.aborted) throw new Error('Swarm request cancelled.');
        throw new Error(combined.aborted ? 'The local helper timed out reading AutoSwarm receipts.' : 'The swarm view could not reach the local helper.');
      }
      if (response.status === 404) throw new Error('This helper does not read AutoSwarm yet. Restart it with the updated app.');
      let data: unknown;
      try { data = await response.json(); } catch { throw new Error('The local helper returned an invalid swarm response.'); }
      if (!response.ok) throw new Error('The local helper could not read AutoSwarm receipts.');
      if (!isSwarmSnapshot(data)) throw new Error('AutoSwarm receipts could not be verified. Nothing is shown rather than a guess.');
      return data;
    },
  };
}

export const fetchSwarmSnapshot = (signal?: AbortSignal) => createSwarmClient().read(signal);

// ---------------------------------------------------------------------------
// Labels. Hues are states, not decoration.

export const STATE_META: Readonly<Record<SwarmState, { label: string; short: string; tone: BadgeToneName; color: string }>> = {
  waiting: { label: 'Waiting on you', short: 'waiting on you', tone: 'warning', color: 'var(--amber)' },
  running: { label: 'Working', short: 'working', tone: 'accent', color: 'var(--accent)' },
  failing: { label: 'Last call failed', short: 'last call failed', tone: 'danger', color: 'var(--red)' },
  verified: { label: 'Verified', short: 'verified', tone: 'positive', color: 'var(--green)' },
  replied: { label: 'Replied, resume not proven', short: 'replied', tone: 'info', color: 'var(--cyan)' },
  found: { label: 'Found, not verified', short: 'not verified', tone: 'neutral', color: 'var(--text-secondary)' },
  off: { label: 'Not found', short: 'not found', tone: 'neutral', color: 'var(--text-muted)' },
};

export const EVIDENCE_META: Readonly<Record<SwarmEvidence, { label: string; tone: BadgeToneName }>> = {
  verified: { label: 'Verified', tone: 'positive' },
  observed: { label: 'Observed', tone: 'info' },
  pending: { label: 'In progress', tone: 'accent' },
  failed: { label: 'Failed', tone: 'danger' },
  none: { label: 'Not verified', tone: 'neutral' },
  unsupported: { label: 'Not supported', tone: 'neutral' },
};

export const CALL_STATUS_META: Readonly<Record<SwarmCallStatus, { label: string; tone: BadgeToneName }>> = {
  running: { label: 'Running', tone: 'accent' },
  completed: { label: 'Completed', tone: 'positive' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  interrupted: { label: 'Interrupted', tone: 'warning' },
  unknown: { label: 'Unreadable', tone: 'warning' },
};

export const CALL_KIND_LABEL: Readonly<Record<SwarmCallKind, string>> = {
  probe: 'Doctor probe', 'probe-resume': 'Probe resume', resume: 'Resume', task: 'Task',
};

export function statusLine(provider: Pick<SwarmProvider, 'state' | 'pendingApprovals' | 'lastErrorCode' | 'model'>): string {
  if (provider.state === 'waiting') return `${provider.pendingApprovals} waiting on you`;
  if (provider.state === 'running') return provider.model ? `working · ${provider.model}` : 'working';
  if (provider.state === 'failing') return provider.lastErrorCode ? `failed: ${provider.lastErrorCode}` : 'last call failed';
  return STATE_META[provider.state].short;
}

export function visibleProviders(snapshot: Pick<SwarmSnapshot, 'providers' | 'hideUnconfigured'>, showAll: boolean): SwarmProvider[] {
  return snapshot.providers.filter((provider) => !provider.hidden && (showAll || !snapshot.hideUnconfigured || provider.state !== 'off'));
}

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return 'Unavailable';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'Unavailable';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

export function duration(msValue: number | null): string {
  if (msValue === null || !Number.isFinite(msValue)) return 'Unavailable';
  const seconds = Math.round(msValue / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// ---------------------------------------------------------------------------
// Commands. The page never runs anything; it hands you the exact line.

export const AUTOSWARM_INSTALL_COMMAND = 'git clone https://github.com/HKUDS/AutoSwarm.git && cd AutoSwarm && uv tool install --force . && autoswarm setup --host codex';

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,~-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

const agentFlags = (ids: readonly string[]) => ids.map((id) => `--agent ${shellWord(id)}`).join(' ');

/** Spends model calls: one reply and one native resume per agent. */
export function probeCommand(ids: readonly string[], workspace: string | null): string {
  return `autoswarm doctor ${agentFlags(ids)} --probe --cwd ${workspace ? shellWord(workspace) : '.'}`;
}

/** Free: executable discovery only, no model call, proves nothing about login. */
export function checkCommand(ids: readonly string[]): string {
  return `autoswarm doctor ${agentFlags(ids)}`.trim();
}

export const inspectCommand = (callId: string) => `autoswarm inspect ${shellWord(callId)}`;

/** `--by user` relays your decision; it is not permission for an agent to decide. */
export function decisionCommand(callId: string, requestId: string, allow: boolean): string {
  return `autoswarm ${allow ? 'approve' : 'deny'} ${shellWord(callId)} ${shellWord(requestId)} --by user`;
}

// ---------------------------------------------------------------------------
// Orbit geometry: you at the top as the approval gate, AutoSwarm at the
// centre, agents on one ring, harnesses AutoSwarm cannot call on a dashed
// outer ring. Pure numbers; the page draws them.

export interface OrbitPoint { x: number; y: number; r: number; angle: number }
export interface OrbitLayout {
  width: number;
  height: number;
  hub: { x: number; y: number; r: number };
  owner: { x: number; y: number; r: number };
  ring: number;
  outer: number | null;
  agents: OrbitPoint[];
  extras: OrbitPoint[];
}

export function orbitLayout(agentCount: number, extraCount: number, width = 640): OrbitLayout {
  const hasOuter = extraCount > 0;
  const height = hasOuter ? 720 : 600;
  const hub = { x: width / 2, y: hasOuter ? 388 : 330, r: 34 };
  const ring = hasOuter ? 168 : 178;
  const outer = hasOuter ? ring + 92 : null;
  const agentRadius = agentCount > 9 ? 24 : agentCount > 6 ? 28 : 32;
  const place = (index: number, total: number, radius: number, size: number, offset: number): OrbitPoint => {
    const angle = -90 + offset + (360 * (index + 0.5)) / Math.max(1, total);
    const radians = (angle * Math.PI) / 180;
    return { x: hub.x + radius * Math.cos(radians), y: hub.y + radius * Math.sin(radians), r: size, angle };
  };
  return {
    width,
    height,
    hub,
    owner: { x: hub.x, y: 50, r: 24 },
    ring,
    outer,
    agents: Array.from({ length: agentCount }, (_, index) => place(index, agentCount, ring, agentRadius, 0)),
    // Offset half an agent step so an outer node never sits on an agent's spoke and labels.
    extras: outer ? Array.from({ length: extraCount }, (_, index) => place(index, extraCount, outer, 22, 180 / Math.max(1, agentCount))) : [],
  };
}

/** Wire weight from a week of calls: visible at zero, capped so one agent cannot shout. */
export function wireWidth(callsThisWeek: number): number {
  return Number((1.25 + Math.min(3, Math.log1p(Math.max(0, callsThisWeek)) * 0.9)).toFixed(2));
}

// ---------------------------------------------------------------------------
// The hosted demo's example team. Labelled as sample data wherever it shows.

const SAMPLE_NOW = Date.parse('2026-11-03T06:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(SAMPLE_NOW - minutes * 60_000).toISOString();
const zeroCalls = (): SwarmCallCounts => ({ total: 0, last7d: 0, running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 });

function sampleModel(id: string, sources: string[], isDefault = false, isNew = false): SwarmModel {
  return { id, sources, default: isDefault, firstSeen: minutesAgo(isNew ? 1440 : 40_000), lastSeen: minutesAgo(60), accepted: sources.includes('autoswarm') ? 3 : 0, rejected: 0, effortRejected: 0, new: isNew };
}

const SAMPLE_BINARIES: Readonly<Record<string, string>> = { 'claude-code': 'claude', cursor: 'cursor-agent' };

function sampleProvider(id: string, label: string, cat: CatClass, state: SwarmState, patch: Partial<SwarmProvider> = {}): SwarmProvider {
  return {
    id, label, name: label, role: null, cat, note: null, model: null, effort: null, hidden: false, meowSource: null,
    command: { binary: SAMPLE_BINARIES[id] ?? id, overridden: false, executable: state === 'off' ? 'not-found' : 'found' },
    hostInstalled: false, calls: zeroCalls(), pendingApprovals: 0, lastCallAt: null, lastStatus: null, lastErrorCode: null,
    evidence: { probe: null, reply: 'none', resume: 'none', approvalRelay: 'none' }, state, ...patch,
  };
}

export const SAMPLE_SWARM: SwarmSnapshot = {
  ok: true,
  schemaVersion: 1,
  scope: 'sample',
  generatedAt: new Date(SAMPLE_NOW).toISOString(),
  autoswarm: {
    home: '~/Library/Application Support/autoswarm',
    exists: true,
    config: 'ok',
    delegateApprovals: { value: true, source: 'default' },
    entryPoints: [{ path: '~/.agents/skills/autoswarm', hosts: ['codex'], installed: true }],
  },
  overlay: { path: '~/.meow-ops/swarm.json', loaded: false, error: null },
  owner: null,
  workspace: '~/projects/example-app',
  workspaceSource: 'latest-call',
  hideUnconfigured: true,
  providers: [
    sampleProvider('codex', 'Codex', 'architect', 'verified', {
      meowSource: 'codex', hostInstalled: true, lastCallAt: minutesAgo(42), lastStatus: 'completed',
      models: { effort: { supported: true, evidence: 'call_sample09' }, models: [sampleModel('example-codex-model', ['config', 'sessions'], true), sampleModel('example-codex-mini', ['sessions'], false, true)] },
      calls: { ...zeroCalls(), total: 14, last7d: 9, completed: 13, failed: 1 },
      evidence: { probe: { at: minutesAgo(300), status: 'verified', initialCallId: 'call_sample01', resumeCallId: 'call_sample02', errorCode: null }, reply: 'verified', resume: 'verified', approvalRelay: 'verified' },
    }),
    sampleProvider('claude-code', 'Claude Code', 'builder', 'running', {
      meowSource: 'claude', model: 'opus', lastCallAt: minutesAgo(3), lastStatus: 'running',
      models: { effort: { supported: 'unknown', evidence: null }, models: [sampleModel('opus', ['autoswarm', 'config', 'sessions'], true), sampleModel('sonnet', ['sessions'])] },
      calls: { ...zeroCalls(), total: 11, last7d: 7, running: 1, completed: 10 },
      evidence: { probe: { at: minutesAgo(290), status: 'verified', initialCallId: 'call_sample03', resumeCallId: 'call_sample04', errorCode: null }, reply: 'verified', resume: 'verified', approvalRelay: 'observed' },
    }),
    sampleProvider('cursor', 'Cursor', 'commander', 'found', { meowSource: 'cursor' }),
    sampleProvider('hermes', 'Hermes', 'guardian', 'waiting', {
      meowSource: 'hermes', pendingApprovals: 1, lastCallAt: minutesAgo(8), lastStatus: 'running',
      models: { effort: { supported: false, evidence: 'call_sample08' }, models: [sampleModel('example-hermes-model', ['config'], true)] },
      calls: { ...zeroCalls(), total: 4, last7d: 4, running: 1, completed: 3 },
      evidence: { probe: null, reply: 'observed', resume: 'none', approvalRelay: 'pending' },
    }),
    sampleProvider('dsh', 'DeepSeek Harness', 'detective', 'failing', {
      meowSource: 'deepseek', lastCallAt: minutesAgo(95), lastStatus: 'failed', lastErrorCode: 'provider_unavailable',
      calls: { ...zeroCalls(), total: 2, last7d: 2, failed: 2 },
      evidence: { probe: { at: minutesAgo(95), status: 'failed', initialCallId: 'call_sample07', resumeCallId: null, errorCode: 'provider_unavailable' }, reply: 'failed', resume: 'none', approvalRelay: 'none' },
    }),
    sampleProvider('grok', 'Grok Build', 'storyteller', 'off'),
    sampleProvider('kimi', 'Kimi Code', 'architect', 'off'),
    sampleProvider('opencode', 'OpenCode', 'builder', 'off'),
    sampleProvider('copilot', 'GitHub Copilot CLI', 'commander', 'off'),
    sampleProvider('muse', 'Meta Muse Code', 'storyteller', 'off'),
    sampleProvider('codebuddy', 'CodeBuddy', 'detective', 'off'),
    sampleProvider('nanobot', 'Nanobot', 'guardian', 'off', { evidence: { probe: null, reply: 'none', resume: 'none', approvalRelay: 'unsupported' } }),
  ],
  extras: [],
  calls: [
    { id: 'call_sample11', provider: 'claude-code', status: 'running', kind: 'task', createdAt: minutesAgo(3), finishedAt: null, durationMs: null, workspaceName: 'example-app', snippet: 'Add tests for the date range parser and fix the off-by-one at month end', errorCode: null, model: 'opus', effort: null, resumes: null, approvals: 0 },
    { id: 'call_sample10', provider: 'hermes', status: 'running', kind: 'task', createdAt: minutesAgo(8), finishedAt: null, durationMs: null, workspaceName: 'example-app', snippet: 'Run the preview deploy and report the URL', errorCode: null, model: null, effort: null, resumes: null, approvals: 1 },
    { id: 'call_sample09', provider: 'codex', status: 'completed', kind: 'task', createdAt: minutesAgo(42), finishedAt: minutesAgo(36), durationMs: 360_000, workspaceName: 'example-app', snippet: 'Review the diff for security issues before merge', errorCode: null, model: null, effort: 'high', resumes: null, approvals: 0 },
    { id: 'call_sample07', provider: 'dsh', status: 'failed', kind: 'probe', createdAt: minutesAgo(95), finishedAt: minutesAgo(95), durationMs: 2_000, workspaceName: 'example-app', snippet: null, errorCode: 'provider_unavailable', model: null, effort: null, resumes: null, approvals: 0 },
    { id: 'call_sample03', provider: 'claude-code', status: 'completed', kind: 'probe', createdAt: minutesAgo(290), finishedAt: minutesAgo(290), durationMs: 9_000, workspaceName: 'example-app', snippet: null, errorCode: null, model: null, effort: null, resumes: null, approvals: 0 },
    { id: 'call_sample01', provider: 'codex', status: 'completed', kind: 'probe', createdAt: minutesAgo(300), finishedAt: minutesAgo(300), durationMs: 12_000, workspaceName: 'example-app', snippet: null, errorCode: null, model: null, effort: null, resumes: null, approvals: 0 },
  ],
  approvals: [
    { callId: 'call_sample10', requestId: `approval_${'0'.repeat(32)}`, provider: 'hermes', kind: 'permission', createdAt: minutesAgo(7), title: 'Run npm run deploy:preview' },
  ],
  totals: { found: 5, verified: 2, visible: 5, running: 2, waiting: 1, calls7d: 22, failed7d: 2, callsScanned: 31 },
  coverage: { callDirectories: 31, scanned: 31, truncated: false, unreadable: 0 },
  control: { dispatch: false, launcher: null, error: 'Sample data.', home: '~/Library/Application Support/autoswarm', enabled: false },
};
