import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from './load-env.mjs';
import { acquireProcessLock } from './process-lock.mjs';
import { readSnapshot } from './snapshot-generation.mjs';

const DEFAULT_TIMEOUT_MS = 300_000;
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

function artifactSnapshot(repoRoot, env = process.env) {
  const dataDir = env.MEOW_DATA_DIR || join(repoRoot, 'public', 'data');
  const sessionsPath = join(dataDir, 'sessions.json');
  try {
    const bundle = readSnapshot(dataDir);
    const stat = statSync(bundle ? join(dataDir, 'generations', `${bundle.generation.id}.json`) : sessionsPath);
    const sessions = bundle?.sessions || JSON.parse(readFileSync(sessionsPath, 'utf8'));
    if (!Array.isArray(sessions)) throw new Error('Invalid session artifact.');
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
      generation: bundle?.generation.id || null,
      last_good: bundle?.lastGood || false,
      source_health: (bundle?.summary || safeReadJson(join(dataDir, 'cost-summary.json')))?.sourceHealth || {},
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

function runCommand({ command, args, cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS, killGraceMs = 1500 }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    // Drain child output without relaying transcript/provider errors into the
    // helper's logs. The persisted stage and exit code are the safe diagnostic.
    child.stderr.resume();
    child.stdout.resume();
    let timedOut = false;
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ ok: false, code: null, timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ ok: code === 0 && !timedOut, code, timedOut });
    });
  });
}

async function execute(snapshot, options) {
  const {
    repoRoot,
    node = process.execPath,
    env = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    killGraceMs = 1500,
    limitsTimeoutMs = 15_000,
    refreshLimits = env.MEOW_REFRESH_LIMITS !== '0',
    commandRunner = runCommand,
    runtime = runtimeDir(env),
  } = options;

  try {
    setPhase(snapshot, 'export_sessions', runtime);
    const exported = await commandRunner({
      command: node,
      args: [join(repoRoot, 'sync', 'export-local.mjs')],
      cwd: repoRoot,
      env: { ...env, MEOW_SYNC_LOCK_TOKEN: options.lock.token },
      timeoutMs,
      killGraceMs,
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
    const artifact = artifactSnapshot(repoRoot, env);
    if (!artifact.available || artifact.last_good
      || (artifact.generation ? artifact.generation === snapshot.artifact.generation
        : artifact.mtime === snapshot.artifact.mtime)) {
      return finish(snapshot, 'failed', runtime, {
        artifact,
        failure: {
          stage: 'verify_artifacts',
          code: 'invalid_or_unchanged_snapshot',
          summary: 'The exporter did not publish a fresh, valid snapshot. The last good data is retained.',
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
      killGraceMs,
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
  } catch {
    return finish(snapshot, 'failed', runtime, {
      failure: {
        stage: snapshot.phase,
        code: 'runner_error',
        summary: 'Local sync failed unexpectedly. Check the reported stage and retry; private error text was not recorded.',
        retryable: true,
      },
    });
  } finally {
    options.lock.release();
  }
}

export function startSyncRun(options) {
  const env = options.env || process.env;
  const runtime = options.runtime || runtimeDir(env);
  if (activeRun) {
    return { accepted: false, busy: true, run_id: activeRun.run_id, snapshot: activeRun.snapshot, done: activeRun.done };
  }
  const lock = acquireProcessLock(paths(runtime).lock);
  if (!lock) {
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
    artifact: artifactSnapshot(options.repoRoot, env),
    failure: null,
    warning: null,
  };
  try { persist(snapshot, runtime); }
  catch {
    lock.release();
    throw Object.assign(new Error('Could not save local sync status. Check the runtime directory and retry.'), { code: 'sync_status_write_failed' });
  }
  const entry = { run_id, snapshot, done: null };
  activeRun = entry;
  const done = execute(snapshot, { ...options, env, runtime, lock }).finally(() => {
    if (activeRun === entry) activeRun = null;
  });
  entry.done = done;
  return { accepted: true, busy: false, run_id, snapshot, done };
}

export async function runSync(options) {
  const started = startSyncRun(options);
  if (!started.done) return started.snapshot;
  return started.done;
}

export function getSyncStatus({ repoRoot, env = process.env, runtime = runtimeDir(env) }) {
  const current = safeReadJson(paths(runtime).current);
  const artifact = artifactSnapshot(repoRoot, env);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = join(import.meta.dirname, '..');
  loadEnv(repoRoot);
  const result = await runSync({
    repoRoot, trigger: 'scheduled',
    refreshLimits: process.env.MEOW_REFRESH_LIMITS !== '0' && !process.argv.includes('--no-limits'),
  });
  console.log(JSON.stringify({ state: result.state, completed_at: result.completed_at, source_health: result.artifact?.source_health }));
  if (result.state === 'failed') process.exitCode = 1;
}
