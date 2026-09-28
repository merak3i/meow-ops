import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeFrameDeltas } from '../perf-metrics.mjs';

test('frame summary uses throughput and reports tail frame time from the same sample', () => {
  const deltas = [...Array(8).fill(0.016), 0.04, 0.04];

  assert.deepEqual(summarizeFrameDeltas(deltas), { fps: 48, p95Ms: 40 });
});
