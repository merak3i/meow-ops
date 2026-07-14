import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDailyOperator } from '../daily-operator.mjs';

test('daily operator runs one sync/review cycle and caps DeepSeek at one call', async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'meow-daily-'));
  const env = { MEOW_RUNTIME_DIR: runtime, MEOW_LLM_CALLS_PER_CYCLE: '25' };
  try {
    const result = await runDailyOperator({
      repoRoot: runtime,
      env,
      now: new Date('2026-07-14T03:00:00.000Z'),
      deps: {
        runSync: async () => ({ state: 'succeeded', run_id: 'sync_test', artifact: { sessions: 12 } }),
        runDigest: async () => ({ health: { flagged: 0 }, proposals: { pending: 0 } }),
      },
    });
    assert.equal(env.MEOW_LLM_CALLS_PER_CYCLE, '1');
    assert.equal(result.nudge.level, 'quiet');
    const saved = JSON.parse(readFileSync(join(runtime, 'daily-nudge.json'), 'utf8'));
    assert.equal(saved.sync_run_id, 'sync_test');
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('daily operator turns a failed sync into a repair nudge', async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'meow-daily-'));
  try {
    const result = await runDailyOperator({
      repoRoot: runtime,
      env: { MEOW_RUNTIME_DIR: runtime },
      deps: {
        runSync: async () => ({ state: 'failed', phase: 'export_sessions', failure: { stage: 'export_sessions', summary: 'export failed' } }),
        runDigest: async () => ({ health: { flagged: 0 }, proposals: { pending: 0 } }),
      },
    });
    assert.equal(result.nudge.level, 'action');
    assert.equal(result.nudge.prompt, 'Prepare a repair prompt');
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});
