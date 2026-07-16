import test from 'node:test';
import assert from 'node:assert/strict';

import { effectiveStatus, isGateStale } from '../../src/pages/loop-ops/gate-status.mjs';

const now = new Date('2026-07-16T12:00:00.000Z');
const entity = { status: 'passed' };
const gate = (status, lastCheckedAt) => ({ status, lastCheckedAt });

test('fresh gates degrade an entity to the worst gate status', () => {
  assert.equal(effectiveStatus(entity, [
    gate('passed', '2026-07-16T11:00:00.000Z'),
    gate('blocked', '2026-07-16T10:00:00.000Z'),
  ], now), 'blocked');
});

test('a gate older than seven days becomes needs-review', () => {
  const stale = gate('passed', '2026-07-08T11:59:59.000Z');
  assert.equal(isGateStale(stale, now), true);
  assert.equal(effectiveStatus(entity, [stale], now), 'needs-review');
});

test('empty gates become needs-review and gates never improve entity status', () => {
  assert.equal(effectiveStatus(entity, [], now), 'needs-review');
  assert.equal(effectiveStatus({ status: 'failed' }, [gate('passed', '2026-07-16T11:00:00.000Z')], now), 'failed');
});
