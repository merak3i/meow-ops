import test from 'node:test';
import assert from 'node:assert/strict';

import { ledgerRunToLoopRun } from '../loop-ledger-to-runs.mjs';
import { isValidLoopRun } from '../../src/pages/loop-ops/run-validation.mjs';

const fixture = [
  {
    run_id: 'run-new',
    loop_id: 'meow-ops-dev',
    captured_at: '2026-07-16T12:00:00.000Z',
    sources: ['claude', 'codex'],
    session_ids: ['session-1'],
    metrics: { cost_usd_real: 12.5, total_tokens: 4200, tool_error_count: 0 },
    artifacts: [{
      id: 'artifact-1', runId: 'run-new', type: 'report', pathOrUrl: 'report.json',
      createdAt: '2026-07-16T12:00:00.000Z', reviewStatus: 'pending',
    }],
    notes: 'Light the cockpit',
  },
  {
    run_id: 'run-failed',
    loop_id: 'meow-ops-guardrails',
    captured_at: '2026-07-15T12:00:00.000Z',
    sources: ['codex'],
    session_ids: ['session-2'],
    metrics: { cost_usd_real: 3.25, total_tokens: 800, tool_error_count: 2 },
  },
];

test('maps ledger records to the same valid LoopRun contract used by the UI', () => {
  const rows = fixture.map(ledgerRunToLoopRun);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(isValidLoopRun));
  assert.ok(rows.every((row) => row.cost.usd > 0));
  assert.deepEqual(rows[0].entityIds, ['meow-ops-dev']);
  assert.equal(rows[0].operator, 'claude+codex');
  assert.equal(rows[1].state, 'failed');
  assert.equal(rows[1].goal, 'meow-ops-guardrails');
});
