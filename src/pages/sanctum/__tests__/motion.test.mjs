import assert from 'node:assert/strict';
import test from 'node:test';

import { nextWalkFrame, PHASE_STEP, stepPeriodForSpeed } from '../motion.js';

test('step cadence derives from champion ground speed', () => {
  assert.ok(Math.abs(stepPeriodForSpeed(2.2) - 0.25) < 0.001);
  assert.ok(Math.abs(stepPeriodForSpeed(0.8) - 0.6875) < 0.001);
});

test('walk frames cycle through four distinct poses', () => {
  assert.deepEqual([0, 1, 2, 3].map(nextWalkFrame), [1, 2, 3, 0]);
});

test('idle loops use the golden angle phase step', () => {
  assert.ok(Math.abs(PHASE_STEP - 2.39996) < 0.000001);
});
