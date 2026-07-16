import test from 'node:test';
import assert from 'node:assert/strict';
import { diffEventSnapshots, snapshotSessions } from '../events.js';

const session = (id, ghost = false, cost = 0.4) => ({ session_id: id, is_ghost: ghost, estimated_cost_usd: cost });

test('new, completed, ghost, spend, and selection beats queue in ritual order', () => {
  const before = snapshotSessions([session('live')], 'live', 0.4);
  const after = snapshotSessions([session('live', true, 1.2), session('new')], 'new', 1.6);
  assert.deepEqual(diffEventSnapshots(before, after).map((event) => event.type), ['E1', 'E3', 'E4', 'E5']);
});

test('removed live sessions produce one completion beat and stable snapshots do not replay', () => {
  const before = snapshotSessions([session('done')], null, 0.4);
  const after = snapshotSessions([], null, 0.4);
  assert.deepEqual(diffEventSnapshots(before, after).map((event) => event.type), ['E2']);
  assert.deepEqual(diffEventSnapshots(after, after), []);
});
