// sync/swarm-status.mjs: read-only AutoSwarm receipts for Today · Swarm.
//
// AutoSwarm (MIT, https://github.com/HKUDS/AutoSwarm) hands one task to the
// coding agents already installed on this machine and keeps a small receipt for
// every delegated call:
//
//   <home>/config.json                                    provider overrides, approval default
//   <home>/calls/call_<hex>/task.json                     provider, prompt, workspace, timing
//   <home>/calls/call_<hex>/handle.json                   runner pid while a call runs
//   <home>/calls/call_<hex>/result.json                   outcome, native session id, error
//   <home>/calls/call_<hex>/cancel.json                   cancel requested
//   <home>/calls/call_<hex>/approvals/approval_<hex>/     request, decision, resolution
//
// Native agents own their histories. This module only reads receipts. It never
// starts a call, answers an approval, runs a provider binary, or writes inside
// the AutoSwarm home. Prompts leave as a short redacted snippet (nothing at all
// with MEOW_NO_SNIPPETS=1); call output never leaves.
//
// An optional local file, ~/.meow-ops/swarm.json (or MEOW_SWARM_CONFIG), names
// the roster: who each agent is, its cat, the probe workspace, and harnesses
// AutoSwarm cannot call. It is personal and lives outside the repository.

import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';

import { redactEvidenceText } from './project-evidence.mjs';

export const SWARM_SCHEMA_VERSION = 1;
export const CAT_CLASSES = Object.freeze(['architect', 'builder', 'commander', 'detective', 'guardian', 'storyteller', 'ghost']);

// The providers AutoSwarm can call, in its README order, with the binary it
// looks for. `cat` is the default Meow Ops class; swarm.json can recast it.
export const PROVIDERS = Object.freeze([
  { id: 'codex', label: 'Codex', binary: 'codex', cat: 'architect', meowSource: 'codex' },
  { id: 'claude-code', label: 'Claude Code', binary: 'claude', cat: 'builder', meowSource: 'claude' },
  { id: 'cursor', label: 'Cursor', binary: 'cursor-agent', cat: 'commander', meowSource: 'cursor' },
  { id: 'hermes', label: 'Hermes', binary: 'hermes', cat: 'guardian', meowSource: 'hermes' },
  { id: 'dsh', label: 'DeepSeek Harness', binary: 'dsh', cat: 'detective', meowSource: 'deepseek' },
  { id: 'grok', label: 'Grok Build', binary: 'grok', cat: 'storyteller', meowSource: null },
  { id: 'kimi', label: 'Kimi Code', binary: 'kimi', cat: 'architect', meowSource: null },
  { id: 'opencode', label: 'OpenCode', binary: 'opencode', cat: 'builder', meowSource: null },
  { id: 'copilot', label: 'GitHub Copilot CLI', binary: 'copilot', cat: 'commander', meowSource: null },
  { id: 'muse', label: 'Meta Muse Code', binary: 'muse', cat: 'storyteller', meowSource: null },
  { id: 'codebuddy', label: 'CodeBuddy', binary: 'codebuddy', cat: 'detective', meowSource: null },
  { id: 'nanobot', label: 'Nanobot', binary: 'nanobot', cat: 'guardian', meowSource: null, approvalRelay: false },
]);

const PROVIDER_IDS = new Set(PROVIDERS.map((provider) => provider.id));
const ALIASES = Object.freeze({
  claude: 'claude-code', claude_code: 'claude-code', 'cursor-agent': 'cursor', 'github-copilot': 'copilot',
  'muse-code': 'muse', 'meta-muse-code': 'muse', 'codebuddy-code': 'codebuddy', 'hermes-agent': 'hermes',
  'nanobot-ai': 'nanobot', 'deepseek-harness': 'dsh', 'grok-build': 'grok', grok_build: 'grok',
  'kimi-code': 'kimi', 'kimi-cli': 'kimi',
});
const MEOW_SOURCES = new Set(['claude', 'codex', 'cursor', 'aider', 'antigravity', 'hermes', 'deepseek']);

const DAY_MS = 24 * 60 * 60 * 1000;
const CALL_DIR = /^call_[a-f0-9]+$/;
const APPROVAL_DIR = /^approval_[a-f0-9]{32}$/;
const PROBE_INITIAL = /^Remember the exact phrase (AUTOSWARM_CHECK_[a-f0-9]{32})\./;
const PROBE_RESUME = /^What exact phrase did I ask you to remember\?/;

export function canonicalProvider(name) {
  const value = typeof name === 'string' ? name.trim().toLowerCase() : '';
  const id = ALIASES[value] ?? value;
  return PROVIDER_IDS.has(id) ? id : null;
}

function expandHome(value, home) {
  return value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value;
}

/** AutoSwarm's own default home: AUTOSWARM_HOME, else the platform state folder. */
export function autoswarmHome({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  if (env.AUTOSWARM_HOME) return resolve(expandHome(env.AUTOSWARM_HOME, home));
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'autoswarm');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'autoswarm');
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'autoswarm');
}

export function swarmOverlayPath({ env = process.env, home = homedir() } = {}) {
  return env.MEOW_SWARM_CONFIG ? resolve(expandHome(env.MEOW_SWARM_CONFIG, home)) : join(home, '.meow-ops', 'swarm.json');
}

function isDirectory(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function readJson(path, maxBytes = 1_000_000) {
  let size;
  try { size = statSync(path).size; } catch (error) { return { status: error?.code === 'ENOENT' ? 'missing' : 'unreadable', value: null }; }
  if (size > maxBytes) return { status: 'too-large', value: null };
  try { return { status: 'ok', value: JSON.parse(readFileSync(path, 'utf8')) }; } catch { return { status: 'unreadable', value: null }; }
}

const record = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const iso = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null);
const ms = (value) => (value ? Date.parse(value) : Number.NaN);

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function isExecutableFile(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where AutoSwarm would find a provider CLI: `found`, `not-found` on this
 * helper's PATH plus the usual install folders, or `unknown`. It never runs it.
 */
export function locateExecutable(command, { env = process.env, home = homedir(), platform = process.platform } = {}) {
  if (typeof command !== 'string' || !command.trim()) return 'unknown';
  const value = expandHome(command.trim(), home);
  if (isAbsolute(value)) return isExecutableFile(value) ? 'found' : 'not-found';
  if (value.includes('/') || value.includes('\\')) return 'unknown';
  const dirs = new Set([
    ...String(env.PATH || '').split(delimiter).filter(Boolean),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
    join(home, '.local', 'bin'), join(home, '.claude', 'local'), join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'), join(home, '.cargo', 'bin'), join(home, 'bin'),
  ]);
  const extensions = platform === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of dirs) {
    for (const extension of extensions) if (isExecutableFile(join(dir, value + extension))) return 'found';
  }
  return 'not-found';
}

/** AutoSwarm installs its Skill per host. Codex, Muse and DeepSeek Harness share ~/.agents. */
function entryPoints({ env, home }) {
  const xdg = env.XDG_CONFIG_HOME || join(home, '.config');
  const rows = [
    [join(home, '.agents', 'skills', 'autoswarm'), ['codex', 'muse']],
    [join(env.DSH_AGENTS_HOME || join(home, '.agents'), 'skills', 'autoswarm'), ['dsh']],
    [join(home, '.claude', 'skills', 'autoswarm'), ['claude-code']],
    [join(xdg, 'opencode', 'skills', 'autoswarm'), ['opencode']],
    [join(home, '.cursor', 'skills', 'autoswarm'), ['cursor']],
    [join(home, '.copilot', 'skills', 'autoswarm'), ['copilot']],
    [join(home, '.codebuddy', 'skills', 'autoswarm'), ['codebuddy']],
    [join(env.HERMES_HOME || join(home, '.hermes'), 'skills', 'autoswarm'), ['hermes']],
    [join(home, '.nanobot', 'workspace', 'skills', 'autoswarm'), ['nanobot']],
    [join(home, '.grok', 'skills', 'autoswarm'), ['grok']],
    [join(env.KIMI_CODE_HOME || join(home, '.kimi-code'), 'skills', 'autoswarm'), ['kimi']],
  ];
  const byPath = new Map();
  for (const [path, hosts] of rows) byPath.set(path, [...new Set([...(byPath.get(path) ?? []), ...hosts])]);
  return [...byPath].map(([path, hosts]) => ({ path, hosts, installed: existsSync(join(path, 'SKILL.md')) }));
}

function snippet(value, max = 140) {
  if (typeof value !== 'string') return null;
  const flat = redactEvidenceText(value).replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const flat = value.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, max) : null;
}

function approvalTitle(request) {
  const native = record(request?.native_request) ? request.native_request : {};
  const params = record(native.params) ? native.params : {};
  const candidates = [
    native.title, native.toolCall?.title, params.toolCall?.title, params.title,
    native.tool_name, native.toolName, params.tool_name, native.command, params.command, native.method,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  const label = request?.kind === 'interaction_required' ? 'Question' : 'Permission';
  return snippet(found, 90) ?? label;
}

// ---------------------------------------------------------------------------
// Personal roster (swarm.json). Unknown keys are dropped; nothing here can
// change what is verified, only how it is named and drawn.

export function readSwarmOverlay(path) {
  const empty = { path, loaded: false, error: null, owner: null, workspace: null, hideUnconfigured: null, providers: {}, extras: [] };
  const raw = readJson(path, 200_000);
  if (raw.status === 'missing') return empty;
  if (raw.status !== 'ok' || !record(raw.value)) return { ...empty, error: raw.status === 'too-large' ? 'swarm.json is larger than 200 KB.' : 'swarm.json is not valid JSON.' };
  const value = raw.value;
  const cat = (input) => (CAT_CLASSES.includes(input) ? input : null);
  const providers = {};
  if (record(value.providers)) {
    for (const [key, entry] of Object.entries(value.providers)) {
      const id = canonicalProvider(key);
      if (!id || !record(entry)) continue;
      providers[id] = {
        name: cleanText(entry.name, 40), role: cleanText(entry.role, 60), cat: cat(entry.cat),
        note: cleanText(entry.note, 220), model: cleanText(entry.model, 60), effort: cleanText(entry.effort, 30),
        hidden: entry.hidden === true,
      };
    }
  }
  const extras = [];
  const seen = new Set();
  for (const entry of Array.isArray(value.extras) ? value.extras.slice(0, 12) : []) {
    if (!record(entry)) continue;
    const id = cleanText(entry.id, 40)?.toLowerCase();
    if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id) || seen.has(id) || PROVIDER_IDS.has(id)) continue;
    seen.add(id);
    extras.push({
      id, name: cleanText(entry.name, 40) ?? id, role: cleanText(entry.role, 60), cat: cat(entry.cat) ?? 'ghost',
      where: cleanText(entry.where, 60), note: cleanText(entry.note, 220),
      meowSource: MEOW_SOURCES.has(entry.source) ? entry.source : null,
    });
  }
  const owner = record(value.owner) ? { name: cleanText(value.owner.name, 40), title: cleanText(value.owner.title, 40) } : null;
  return {
    path, loaded: true, error: null,
    owner: owner && (owner.name || owner.title) ? owner : null,
    workspace: cleanText(value.workspace, 400),
    hideUnconfigured: typeof value.hideUnconfigured === 'boolean' ? value.hideUnconfigured : null,
    providers, extras,
  };
}

// ---------------------------------------------------------------------------
// Call receipts.

function readCall(directory, name, isAlive) {
  const task = readJson(join(directory, 'task.json'));
  if (task.status !== 'ok' || !record(task.value)) return { unreadable: task.status !== 'missing' };
  const result = readJson(join(directory, 'result.json'), 5_000_000);
  const handle = readJson(join(directory, 'handle.json'));
  const cancelled = existsSync(join(directory, 'cancel.json'));
  const t = task.value;
  const r = result.status === 'ok' && record(result.value) ? result.value : null;
  const h = handle.status === 'ok' && record(handle.value) ? handle.value : null;

  let status;
  if (r) status = ['completed', 'failed', 'cancelled'].includes(r.outcome) ? r.outcome : 'failed';
  else if (result.status === 'too-large' || result.status === 'unreadable') status = 'unknown';
  else if (h && isAlive(h.pid)) status = 'running';
  else status = cancelled ? 'cancelled' : 'interrupted';

  const prompt = typeof t.prompt === 'string' ? t.prompt : '';
  const probeToken = prompt.match(PROBE_INITIAL)?.[1] ?? null;
  const kind = probeToken ? 'probe' : PROBE_RESUME.test(prompt) && t.previous_call ? 'probe-resume' : t.previous_call ? 'resume' : 'task';
  const content = typeof r?.content === 'string' ? r.content : '';

  const approvals = [];
  const approvalsDir = join(directory, 'approvals');
  if (isDirectory(approvalsDir)) {
    for (const entry of readdirSync(approvalsDir).filter((item) => APPROVAL_DIR.test(item)).sort()) {
      const path = join(approvalsDir, entry);
      const request = readJson(join(path, 'request.json'));
      if (request.status !== 'ok' || !record(request.value)) continue;
      const resolution = readJson(join(path, 'resolution.json'));
      const decided = existsSync(join(path, 'decision.json'));
      approvals.push({
        requestId: entry,
        kind: request.value.kind === 'interaction_required' ? 'question' : 'permission',
        createdAt: iso(request.value.created_at),
        title: approvalTitle(request.value),
        decided,
        resolved: resolution.status === 'ok',
        replied: resolution.status === 'ok' && ['replied', 'settled_by_native'].includes(resolution.value?.state),
      });
    }
  }

  return {
    id: name,
    provider: canonicalProvider(t.provider) ?? 'unknown',
    status,
    kind,
    probeToken,
    prompt,
    content,
    contentChars: content.length,
    previousCall: typeof t.previous_call === 'string' ? t.previous_call : null,
    createdAt: iso(t.created_at),
    finishedAt: iso(r?.finished_at),
    workspace: typeof t.workspace === 'string' ? t.workspace : null,
    model: cleanText(t.model, 60),
    effort: cleanText(t.effort, 30),
    nativeSessionId: typeof r?.native_session_id === 'string' && r.native_session_id ? r.native_session_id : null,
    errorCode: cleanText(r?.error_code, 60) ?? (status === 'failed' ? 'failed' : null),
    approvals,
  };
}

function scanCalls(swarmHome, { isAlive, maxCalls }) {
  const callsDir = join(swarmHome, 'calls');
  if (!isDirectory(callsDir)) return { calls: [], total: 0, unreadable: 0 };
  const names = readdirSync(callsDir).filter((name) => CALL_DIR.test(name));
  const dated = names.map((name) => {
    let mtime = 0;
    try { mtime = statSync(join(callsDir, name)).mtimeMs; } catch { /* vanished */ }
    return { name, mtime };
  }).sort((a, b) => b.mtime - a.mtime).slice(0, maxCalls);
  const calls = [];
  let unreadable = 0;
  for (const { name } of dated) {
    const call = readCall(join(callsDir, name), name, isAlive);
    if (call.unreadable) unreadable += 1;
    else if (call.id) calls.push(call);
  }
  calls.sort((a, b) => (ms(b.createdAt) || 0) - (ms(a.createdAt) || 0));
  return { calls, total: names.length, unreadable };
}

// ---------------------------------------------------------------------------

const isPending = (approval) => !approval.decided && !approval.resolved;

function evidenceFor(provider, calls, byId) {
  const mine = calls.filter((call) => call.provider === provider.id);
  const probes = mine.filter((call) => call.kind === 'probe');
  let probe = null;
  if (probes.length) {
    const initial = probes[0];
    const resumed = mine.find((call) => call.previousCall === initial.id) ?? null;
    const replied = initial.status === 'completed' && initial.content.includes(initial.probeToken);
    const verified = replied && resumed?.status === 'completed' && resumed.content.includes(initial.probeToken)
      && Boolean(initial.nativeSessionId) && resumed.nativeSessionId === initial.nativeSessionId;
    const running = initial.status === 'running' || resumed?.status === 'running';
    probe = {
      at: initial.createdAt,
      status: verified ? 'verified' : running ? 'running' : replied ? (resumed ? 'resume-failed' : 'reply-only') : 'failed',
      initialCallId: initial.id,
      resumeCallId: resumed?.id ?? null,
      errorCode: verified ? null : (resumed?.errorCode ?? initial.errorCode ?? null),
    };
  }
  const completed = mine.filter((call) => call.status === 'completed' && call.contentChars > 0);
  const resumes = mine.filter((call) => call.previousCall);
  const resumeOk = resumes.some((call) => {
    const previous = byId.get(call.previousCall);
    return call.status === 'completed' && previous?.nativeSessionId && call.nativeSessionId === previous.nativeSessionId;
  });
  const approvals = mine.flatMap((call) => call.approvals);
  const reply = probe?.status === 'verified' ? 'verified' : completed.length ? 'observed'
    : mine.some((call) => call.status === 'running') ? 'pending' : mine.length ? 'failed' : 'none';
  const resume = probe?.status === 'verified' ? 'verified' : resumeOk ? 'observed'
    : resumes.some((call) => ['failed', 'interrupted'].includes(call.status)) ? 'failed' : 'none';
  const waitingNow = mine.some((call) => call.status === 'running' && call.approvals.some(isPending));
  const approvalRelay = provider.approvalRelay === false ? 'unsupported'
    : approvals.some((item) => item.replied) ? 'verified'
      : approvals.some((item) => item.decided) ? 'observed' : waitingNow ? 'pending' : 'none';
  return { probe, reply, resume, approvalRelay };
}

function stateOf({ pending, running, latest, evidence, found }) {
  if (pending > 0) return 'waiting';
  if (running > 0) return 'running';
  if (latest && ['failed', 'interrupted', 'unknown'].includes(latest.status)) return 'failing';
  if (evidence.probe?.status === 'verified') return 'verified';
  if (evidence.reply === 'observed') return 'replied';
  if (found) return 'found';
  return 'off';
}

/**
 * Snapshot of AutoSwarm on this machine plus the optional personal roster.
 * Every option exists for tests; the helper calls it with none.
 */
export function readSwarmSnapshot(options = {}) {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const now = options.now ?? Date.now();
  const isAlive = options.isAlive ?? pidAlive;
  const maxCalls = options.maxCalls ?? 600;
  const listLimit = options.listLimit ?? 40;
  const snippets = options.snippets ?? env.MEOW_NO_SNIPPETS !== '1';
  const swarmHome = options.autoswarmHome ?? autoswarmHome({ env, platform, home });
  const overlay = readSwarmOverlay(options.overlayPath ?? swarmOverlayPath({ env, home }));

  const exists = isDirectory(swarmHome);
  const config = exists ? readJson(join(swarmHome, 'config.json')) : { status: 'missing', value: null };
  const configValue = config.status === 'ok' && record(config.value) ? config.value : {};
  const configuredProviders = record(configValue.providers) ? configValue.providers : {};
  const delegateRaw = configValue.approvals?.delegate_to_parent;
  const points = entryPoints({ env, home });
  const { calls, total, unreadable } = exists ? scanCalls(swarmHome, { isAlive, maxCalls }) : { calls: [], total: 0, unreadable: 0 };
  const byId = new Map(calls.map((call) => [call.id, call]));
  const weekAgo = now - 7 * DAY_MS;

  const providers = PROVIDERS.map((provider) => {
    const override = configuredProviders[provider.id];
    const command = Array.isArray(override?.command) && typeof override.command[0] === 'string' ? override.command[0] : provider.binary;
    const executable = locateExecutable(command, { env, home, platform });
    const mine = calls.filter((call) => call.provider === provider.id);
    const evidence = evidenceFor(provider, calls, byId);
    const counts = { total: mine.length, last7d: 0, running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 };
    for (const call of mine) {
      if ((ms(call.createdAt) || 0) >= weekAgo) counts.last7d += 1;
      if (call.status === 'unknown') counts.failed += 1;
      else if (call.status in counts) counts[call.status] += 1;
    }
    const pending = mine.filter((call) => call.status === 'running').flatMap((call) => call.approvals.filter(isPending)).length;
    const latest = mine[0] ?? null;
    const personal = overlay.providers[provider.id] ?? {};
    const hostInstalled = points.some((point) => point.installed && point.hosts.includes(provider.id));
    const found = executable === 'found' || Boolean(override) || mine.length > 0;
    return {
      id: provider.id,
      label: provider.label,
      name: personal.name ?? provider.label,
      role: personal.role ?? null,
      cat: personal.cat ?? provider.cat,
      note: personal.note ?? null,
      model: personal.model ?? null,
      effort: personal.effort ?? null,
      hidden: personal.hidden === true,
      meowSource: provider.meowSource,
      command: { binary: basename(command), overridden: Boolean(override), executable },
      hostInstalled,
      calls: counts,
      pendingApprovals: pending,
      lastCallAt: latest?.createdAt ?? null,
      lastStatus: latest?.status ?? null,
      lastErrorCode: mine.find((call) => call.errorCode)?.errorCode ?? null,
      evidence,
      state: stateOf({ pending, running: counts.running, latest, evidence, found }),
    };
  });

  const approvals = calls.filter((call) => call.status === 'running').flatMap((call) => call.approvals
    .filter(isPending)
    .map((item) => ({ callId: call.id, requestId: item.requestId, provider: call.provider, kind: item.kind, createdAt: item.createdAt, title: item.title })));

  const recent = calls.slice(0, listLimit).map((call) => ({
    id: call.id,
    provider: call.provider,
    status: call.status,
    kind: call.kind,
    createdAt: call.createdAt,
    finishedAt: call.finishedAt,
    durationMs: call.createdAt && call.finishedAt ? Math.max(0, ms(call.finishedAt) - ms(call.createdAt)) : null,
    workspaceName: call.workspace ? basename(call.workspace) : null,
    snippet: call.kind === 'probe' || call.kind === 'probe-resume' || !snippets ? null : snippet(call.prompt),
    errorCode: call.errorCode,
    model: call.model,
    effort: call.effort,
    resumes: call.previousCall,
    approvals: call.approvals.length,
  }));

  const lastWorkspace = calls.find((call) => call.kind === 'task' && call.workspace)?.workspace ?? null;
  const visible = providers.filter((provider) => !provider.hidden && provider.state !== 'off');
  return {
    ok: true,
    schemaVersion: SWARM_SCHEMA_VERSION,
    scope: 'local-only',
    generatedAt: new Date(now).toISOString(),
    autoswarm: {
      home: swarmHome,
      exists,
      config: config.status,
      delegateApprovals: typeof delegateRaw === 'boolean' ? { value: delegateRaw, source: 'config' } : { value: true, source: 'default' },
      entryPoints: points,
    },
    overlay: { path: overlay.path, loaded: overlay.loaded, error: overlay.error },
    owner: overlay.owner,
    workspace: overlay.workspace ?? lastWorkspace,
    workspaceSource: overlay.workspace ? 'swarm.json' : lastWorkspace ? 'latest-call' : null,
    hideUnconfigured: overlay.hideUnconfigured ?? true,
    providers,
    extras: overlay.extras,
    calls: recent,
    approvals,
    totals: {
      found: providers.filter((provider) => provider.state !== 'off').length,
      verified: providers.filter((provider) => provider.evidence.probe?.status === 'verified').length,
      visible: visible.length,
      running: calls.filter((call) => call.status === 'running').length,
      waiting: approvals.length,
      calls7d: calls.filter((call) => (ms(call.createdAt) || 0) >= weekAgo).length,
      failed7d: calls.filter((call) => (ms(call.createdAt) || 0) >= weekAgo && ['failed', 'interrupted', 'unknown'].includes(call.status)).length,
      callsScanned: calls.length,
    },
    coverage: { callDirectories: total, scanned: Math.min(total, maxCalls), truncated: total > maxCalls, unreadable },
  };
}
