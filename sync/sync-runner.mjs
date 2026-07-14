import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 90_000;
const PHASES = ['preflight', 'export_sessions', 'verify_artifacts', 'refresh_limits'];
let activeRun = null;

function runtimeDir(env = process.env) {
  return env.MEOW_RUNTIME_DIR || join(homedir(), '.meow-ops', 'runtime');
}

function paths(dir) {
  return {
    current: join(dir, 'sync-current.json'),
    lock: join(dir, 'sync.lock'),
    runs: join(dir, 'sync-runs'),
  };
}

function safeReadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function atomicWrite(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

function artifactSnapshot(repoRoot) {
  const sessionsPath = join(repoRoot, 'public', 'data', 'sessions.json');
  try {
    const stat = statSync(sessionsPath);
    const sessions = JSON.parse(readFileSync(sessionsPath, 'utf8'));
    const source_counts = {};
    if (Array.isArray(sessions)) {
      for (const session of sessions) {
        const source = typeof session?.source === 'string' ? session.source : 'unknown';
        source_counts[source] = (source_counts[source] || 0) + 1;
      }
    }
    return {
      available: true,
      mtime: stat.mtimeMs,
      size: stat.size,
      sessions: Array.isArray(sessions) ? sessions.length : 0,
      source_counts,
    };
  } catch {
    return { available: false, mtime: null, size: null, sessions: 0, source_counts: {} };
  }
}

function persist(snapshot, dir) {
  const target = paths(dir);
  mkdirSync(target.runs, { recursive: true });
  atomicWrite(target.current, snapshot);
  atomicWrite(join(target.runs, `${snapshot.run_id}.json`), snapshot);
}

function phaseRows(activePhase) {
  return PHASES.map((id) => ({
    id,
    status: id === activePhase ? 'running' : 'pending',
    started_at: id === activePhase ? new Date().toISOString() : null,
    completed_at: null,
  }));
}

function setPhase(snapshot, phase, dir) {
  const now = new Date().toISOString();
  for (const row of snapshot.phases) {
    if (row.status === 'running') {
      row.status = 'succeeded';
      row.completed_at = now;
    }
    if (row.id === phase && row.status === 'pending') {
      row.status = 'running';
      row.started_at = now;
    }
  }
  snapshot.phase = phase;
  snapshot.updated_at = now;
  persist(snapshot, dir);
}

function finish(snapshot, state, dir, extra = {}) {
  const now = new Date().toISOString();
  for (const row of snapshot.phases) {
    if (row.status === 'running') {
      row.status = state === 'failed' ? 'failed' : state === 'partial' ? 'warning' : 'succeeded';
      row.completed_at = now;
    }
  }
  Object.assign(snapshot, extra, {
    state,
    ok: state === 'succeeded' || state === 'partial',
    updated_at: now,
    completed_at: now,
  });
  persist(snapshot, dir);
  return snapshot;
}

function runCommand({ command, args, cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-600);
      process.stderr.write(chunk);
    });
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, timedOut: false, error: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, timedOut, stderr });
    });
  });
}

function acquireLock(dir, staleAfterMs) {
  const target = paths(dir);
  mkdirSync(dir, { recursive: true });
  try {
    const fd = openSync(target.lock, 'wx', 0o600);
    writeFileSync(fd, `${process.pid}\n`);
    closeSync(fd);
    return true;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const current = safeReadJson(target.current);
    const age = Date.now() - Date.parse(current?.updated_at || current?.started_at || '');
    if (current?.state === 'running' && Number.isFinite(age) && age < staleAfterMs) return false;
    try { unlinkSync(target.lock); } catch {}
    return acquireLock(dir, staleAfterMs);
  }
}

function releaseLock(dir) {
  try { unlinkSync(paths(dir).lock); } catch {}
}

async function execute(snapshot, options) {
  const {
    repoRoot,
    node = process.execPath,
    env = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    limitsTimeoutMs = 15_000,
    refreshLimits = true,
    commandRunner = runCommand,
    runtime = runtimeDir(env),
  } = options;

  try {
    setPhase(snapshot, 'export_sessions', runtime);
    const exported = await commandRunner({
      command: node,
      args: [join(repoRoot, 'sync', 'export-local.mjs')],
      cwd: repoRoot,
      env,
      timeoutMs,
    });
    if (!exported.ok) {
      return finish(snapshot, 'failed', runtime, {
        failure: {
          stage: 'export_sessions',
          code: exported.timedOut ? 'timeout' : `exit_${exported.code ?? 'spawn'}`,
          summary: exported.timedOut ? 'Session export timed out.' : 'Session export did not complete successfully.',
          retryable: true,
        },
      });
    }

    setPhase(snapshot, 'verify_artifacts', runtime);
    const artifact = artifactSnapshot(repoRoot);
    if (!artifact.available) {
      return finish(snapshot, 'failed', runtime, {
        artifact,
        failure: {
          stage: 'verify_artifacts',
          code: 'missing_sessions_artifact',
          summary: 'The exporter finished but sessions.json was not written.',
          retryable: true,
        },
      });
    }
    snapshot.artifact = artifact;

    if (!refreshLimits || !existsSync(join(repoRoot, 'sync', 'fetch-claude-limits.mjs'))) {
      snapshot.phases.find((row) => row.id === 'refresh_limits').status = 'skipped';
      return finish(snapshot, 'succeeded', runtime, { mtime: artifact.mtime, size: artifact.size });
    }

    setPhase(snapshot, 'refresh_limits', runtime);
    const limits = await commandRunner({
      command: node,
      args: [join(repoRoot, 'sync', 'fetch-claude-limits.mjs')],
      cwd: repoRoot,
      env,
      timeoutMs: limitsTimeoutMs,
    });
    if (!limits.ok) {
      return finish(snapshot, 'partial', runtime, {
        mtime: artifact.mtime,
        size: artifact.size,
        warning: {
          stage: 'refresh_limits',
          code: limits.timedOut ? 'timeout' : `exit_${limits.code ?? 'spawn'}`,
          summary: 'Sessions synced, but the optional limits refresh failed.',
        },
      });
    }
    return finish(snapshot, 'succeeded', runtime, { mtime: artifact.mtime, size: artifact.size });
  } catch (error) {
    return finish(snapshot, 'failed', runtime, {
      failure: {
        stage: snapshot.phase,
        code: 'runner_error',
        summary: error instanceof Error ? error.message.slice(0, 240) : 'Unexpected sync runner error.',
        retryable: true,
      },
    });
  } finally {
    releaseLock(runtime);
    activeRun = null;
  }
}

export function startSyncRun(options) {
  const env = options.env || process.env;
  const runtime = options.runtime || runtimeDir(env);
  if (activeRun) {
    return { accepted: false, busy: true, run_id: activeRun.run_id, snapshot: activeRun.snapshot, done: activeRun.done };
  }
  if (!acquireLock(runtime, (options.timeoutMs || DEFAULT_TIMEOUT_MS) * 2)) {
    const snapshot = getSyncStatus({ repoRoot: options.repoRoot, env, runtime });
    return { accepted: false, busy: true, run_id: snapshot.run_id, snapshot, done: null };
  }

  const now = new Date().toISOString();
  const run_id = `sync_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const snapshot = {
    ok: false,
    run_id,
    state: 'running',
    phase: 'preflight',
    trigger: options.trigger || 'manual',
    started_at: now,
    updated_at: now,
    completed_at: null,
    phases: phaseRows('preflight'),
    artifact: artifactSnapshot(options.repoRoot),
    failure: null,
    warning: null,
  };
  persist(snapshot, runtime);
  const done = execute(snapshot, { ...options, env, runtime });
  activeRun = { run_id, snapshot, done };
  return { accepted: true, busy: false, run_id, snapshot, done };
}

export async function runSync(options) {
  const started = startSyncRun(options);
  if (!started.done) return started.snapshot;
  return started.done;
}

export function getSyncStatus({ repoRoot, env = process.env, runtime = runtimeDir(env) }) {
  const current = safeReadJson(paths(runtime).current);
  const artifact = artifactSnapshot(repoRoot);
  if (!current) {
    return {
      ok: artifact.available,
      run_id: null,
      state: 'idle',
      phase: null,
      phases: [],
      artifact,
      mtime: artifact.mtime,
      size: artifact.size,
    };
  }
  return { ...current, artifact, mtime: artifact.mtime, size: artifact.size };
}

export function getSyncRun(runId, { env = process.env, runtime = runtimeDir(env) } = {}) {
  if (!/^sync_[A-Za-z0-9_-]+$/.test(String(runId || ''))) return null;
  return safeReadJson(join(paths(runtime).runs, `${runId}.json`));
}
