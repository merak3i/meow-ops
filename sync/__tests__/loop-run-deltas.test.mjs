import test from 'node:test';
import assert from 'node:assert/strict';

import { deltaTone, formatSignedPercent, selectRunDeltas } from '../../src/pages/loop-ops/run-deltas.mjs';

test('maps supported run deltas in cockpit order and ignores unknown metrics', () => {
  const comparison = { deltas: {
    total_tokens: { before: 100, after: 200, delta_pct: 100 },
    cost_usd_real: { before: 10, after: 5, delta_pct: -50 },
    tool_error_count: { before: 2, after: 2, delta_pct: 0 },
    duration_seconds: { before: 10, after: 9, delta_pct: -10 },
  } };
  assert.deepEqual(selectRunDeltas(comparison).map(({ metric, tone }) => ({ metric, tone })), [
    { metric: 'cost_usd_real', tone: 'improving' },
    { metric: 'total_tokens', tone: 'worsening' },
    { metric: 'tool_error_count', tone: 'neutral' },
  ]);
});

test('formats signed percentages and classifies tones', () => {
  assert.equal(formatSignedPercent(3465.94), '+3465.94%');
  assert.equal(formatSignedPercent(-74.92), '-74.92%');
  assert.equal(formatSignedPercent(0), '0.00%');
  assert.equal(deltaTone(-1), 'improving');
  assert.equal(deltaTone(1), 'worsening');
  assert.equal(deltaTone(0), 'neutral');
});

test('returns no inferred deltas when comparison data is absent', () => {
  assert.deepEqual(selectRunDeltas(null), []);
  assert.deepEqual(selectRunDeltas({ deltas: {} }), []);
});
