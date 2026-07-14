import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getSyncRun, getSyncStatus, runSync } from '../sync-runner.mjs';

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
