import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getSyncRun, getSyncStatus, runSync, startSyncRun } from '../sync-runner.mjs';
import { publishSnapshot } from '../snapshot-generation.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'meow-sync-runner-'));
  const runtime = join(root, 'runtime');
  const repoRoot = join(root, 'repo');
  mkdirSync(join(repoRoot, 'public', 'data'), { recursive: true });
  mkdirSync(join(repoRoot, 'sync'), { recursive: true });
  writeFileSync(join(repoRoot, 'sync', 'export-local.mjs'), '');
  writeFileSync(join(repoRoot, 'sync', 'fetch-claude-limits.mjs'), '');
  return { root, runtime, repoRoot };
}

test('standalone CLI honors the environment opt-out and the no-limits flag', () => {
  for (const { envValue, args, refreshes } of [
    { envValue: '0', args: [], refreshes: false },
    { envValue: '1', args: ['--no-limits'], refreshes: false },
    { envValue: '1', args: [], refreshes: true },
  ]) {
    const fx = fixture();
    const marker = join(fx.root, 'limits-called');
    try {
      copyFileSync(new URL('../sync-runner.mjs', import.meta.url), join(fx.repoRoot, 'sync', 'sync-runner.mjs'));
      copyFileSync(new URL('../load-env.mjs', import.meta.url), join(fx.repoRoot, 'sync', 'load-env.mjs'));
      copyFileSync(new URL('../snapshot-generation.mjs', import.meta.url), join(fx.repoRoot, 'sync', 'snapshot-generation.mjs'));
      copyFileSync(new URL('../process-lock.mjs', import.meta.url), join(fx.repoRoot, 'sync', 'process-lock.mjs'));
      writeFileSync(join(fx.repoRoot, 'sync', 'export-local.mjs'),
        `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(fx.repoRoot, 'public', 'data', 'sessions.json'))}, '[]');`);
      writeFileSync(join(fx.repoRoot, 'sync', 'fetch-claude-limits.mjs'),
        `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'called');`);
      execFileSync(process.execPath, [realpathSync(join(fx.repoRoot, 'sync', 'sync-runner.mjs')), ...args], {
        cwd: fx.repoRoot, stdio: 'pipe', timeout: 10_000,
        env: {
          ...process.env, MEOW_RUNTIME_DIR: fx.runtime,
          MEOW_DATA_DIR: join(fx.repoRoot, 'public', 'data'), MEOW_REFRESH_LIMITS: envValue,
        },
      });
      const status = JSON.parse(readFileSync(join(fx.runtime, 'sync-current.json')));
      assert.equal(status.state, 'succeeded');
      assert.equal(existsSync(marker), refreshes);
      assert.equal(status.phases.find(phase => phase.id === 'refresh_limits').status,
        refreshes ? 'succeeded' : 'skipped');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }
});

test('sync runner verifies the configured private data directory and source coverage', async () => {
  const fx = fixture();
  const dataDir = join(fx.root, 'private-data');
  mkdirSync(dataDir);
  const sourceHealth = { codex: { state: 'collected', sessions: 1 }, cursor: { state: 'excluded', sessions: 0 } };
  try {
    const env = { ...process.env, MEOW_DATA_DIR: dataDir };
    const result = await runSync({
      repoRoot: fx.repoRoot, runtime: fx.runtime, env, refreshLimits: false,
      commandRunner: async () => {
        writeFileSync(join(dataDir, 'sessions.json'), JSON.stringify([{ session_id: 'one', source: 'codex' }]));
        writeFileSync(join(dataDir, 'cost-summary.json'), JSON.stringify({ sourceHealth }));
        return { ok: true, code: 0 };
      },
    });
    assert.equal(result.state, 'succeeded');
    assert.equal(result.artifact.sessions, 1);
    assert.deepEqual(result.artifact.source_health, sourceHealth);
    assert.equal(getSyncStatus({ repoRoot: fx.repoRoot, runtime: fx.runtime, env }).artifact.sessions, 1);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('sync runner records observable phases and artifact metadata', async () => {
  const fx = fixture();
  try {
    let calls = 0;
    const result = await runSync({
      repoRoot: fx.repoRoot,
      runtime: fx.runtime,
      trigger: 'test',
      commandRunner: async ({ args }) => {
        calls += 1;
        if (args[0].endsWith('export-local.mjs')) {
          writeFileSync(join(fx.repoRoot, 'public', 'data', 'sessions.json'), JSON.stringify([
            { session_id: 'one', source: 'codex' },
            { session_id: 'two', source: 'claude' },
          ]));
        }
        return { ok: true, code: 0 };
      },
    });

    assert.equal(calls, 2);
    assert.equal(result.state, 'succeeded');
    assert.equal(result.artifact.sessions, 2);
    assert.deepEqual(result.artifact.source_counts, { codex: 1, claude: 1 });
    assert.ok(result.phases.every((phase) => phase.status === 'succeeded'));
    assert.equal(getSyncStatus({ repoRoot: fx.repoRoot, runtime: fx.runtime }).run_id, result.run_id);
    assert.equal(getSyncRun(result.run_id, { runtime: fx.runtime }).state, 'succeeded');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('sync runner preserves a persistent, sanitized export failure', async () => {
  const fx = fixture();
  try {
    const result = await runSync({
      repoRoot: fx.repoRoot,
      runtime: fx.runtime,
      commandRunner: async () => ({ ok: false, code: 7, stderr: 'private transcript text' }),
    });
    assert.equal(result.state, 'failed');
    assert.equal(result.failure.stage, 'export_sessions');
    assert.equal(result.failure.code, 'exit_7');
    assert.doesNotMatch(JSON.stringify(result), /private transcript text/);
    const persisted = readFileSync(join(fx.runtime, 'sync-current.json'), 'utf8');
    assert.doesNotMatch(persisted, /private transcript text/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('successful process exit cannot validate a stale or non-array export', async () => {
  for (const artifact of ['[]', '{}']) {
    const fx = fixture();
    try {
      writeFileSync(join(fx.repoRoot, 'public', 'data', 'sessions.json'), artifact);
      const result = await runSync({ repoRoot: fx.repoRoot, runtime: fx.runtime, refreshLimits: false,
        commandRunner: async () => ({ ok: true, code: 0 }) });
      assert.equal(result.state, 'failed');
      assert.equal(result.failure.stage, 'verify_artifacts');
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  }
});

test('sync runner reports partial success when optional limits refresh fails', async () => {
  const fx = fixture();
  try {
    const result = await runSync({
      repoRoot: fx.repoRoot,
      runtime: fx.runtime,
      commandRunner: async ({ args }) => {
        if (args[0].endsWith('export-local.mjs')) {
          writeFileSync(join(fx.repoRoot, 'public', 'data', 'sessions.json'), '[]');
          return { ok: true, code: 0 };
        }
        return { ok: false, code: 2 };
      },
    });
    assert.equal(result.state, 'partial');
    assert.equal(result.ok, true);
    assert.equal(result.warning.stage, 'refresh_limits');
    assert.equal(result.phases.find((phase) => phase.id === 'refresh_limits').status, 'warning');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('failed initial status persistence releases ownership so a repaired retry can run', async () => {
  const fx = fixture();
  try {
    mkdirSync(fx.runtime);
    writeFileSync(join(fx.runtime, 'sync-runs'), 'block directory creation');
    assert.throws(() => startSyncRun({ ...fx }), /status|EEXIST/);
    rmSync(join(fx.runtime, 'sync-runs'));
    let executed = false;
    await runSync({ ...fx, commandRunner: async () => { executed = true; return { ok: false, code: 1 }; } });
    assert.equal(executed, true);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('validated immutable generations do not depend on legacy preview files', async () => {
  const fx = fixture();
  const dataDir = join(fx.root, 'private-data');
  const bundle = { sessions: [{ source: 'codex', session_id: 'one' }], summary: { archive: { total: 1 }, allTime: { sessions: 1 } } };
  try {
    publishSnapshot(dataDir, bundle);
    const env = { MEOW_DATA_DIR: dataDir };
    assert.equal(getSyncStatus({ ...fx, env }).artifact.available, true);
    const result = await runSync({ ...fx, env, refreshLimits: false,
      commandRunner: async () => { publishSnapshot(dataDir, bundle); return { ok: true, code: 0 }; } });
    assert.equal(result.state, 'succeeded');
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('thrown command errors cannot put private text into run status', async () => {
  const fx = fixture();
  try {
    const result = await runSync({ ...fx, commandRunner: async () => { throw new Error('private transcript sentinel'); } });
    assert.equal(result.state, 'failed');
    assert.doesNotMatch(JSON.stringify(result), /private transcript sentinel/);
    assert.doesNotMatch(readFileSync(join(fx.runtime, 'sync-current.json'), 'utf8'), /private transcript sentinel/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('timeouts escalate when a child ignores termination and release ownership after exit', async () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.repoRoot, 'sync', 'export-local.mjs'), 'trap "" TERM\nexec /bin/sleep 4\n');
    const started = Date.now();
    const result = await runSync({ ...fx, node: '/bin/sh', timeoutMs: 400, killGraceMs: 100, refreshLimits: false });
    assert.equal(result.failure.code, 'timeout');
    assert.ok(Date.now() - started < 3000, 'timeout must not wait for an unresponsive child to finish naturally');
    let executed = false;
    await runSync({ ...fx, commandRunner: async () => { executed = true; return { ok: false, code: 1 }; } });
    assert.equal(executed, true);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});
