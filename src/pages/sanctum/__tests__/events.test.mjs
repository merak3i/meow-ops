import test from 'node:test';
import assert from 'node:assert/strict';
import { diffEventSnapshots, LIVE_SESSION_WINDOW_MS, snapshotSessions } from '../events.js';

const NOW = Date.parse('2026-07-16T10:00:00.000Z');
const session = (id, ghost = false, cost = 0.4, endedAt = NOW) => ({
  session_id: id,
  is_ghost: ghost,
  estimated_cost_usd: cost,
  ended_at: new Date(endedAt).toISOString(),
});

test('new, completed, ghost, spend, and selection beats queue in ritual order', () => {
  const before = snapshotSessions([session('live')], 'live', 0.4, 'run-a', NOW);
  const after = snapshotSessions([session('live', true, 1.2), session('new')], 'new', 1.6, 'run-a', NOW);
  assert.deepEqual(diffEventSnapshots(before, after).map((event) => event.type), ['E1', 'E3', 'E4', 'E5']);
});

test('a live session aging out produces one completion beat and stable snapshots do not replay', () => {
  const before = snapshotSessions([session('done')], null, 0.4, 'run-a', NOW);
  const after = snapshotSessions(
    [session('done')],
    null,
    0.4,
    'run-a',
    NOW + LIVE_SESSION_WINDOW_MS + 1,
  );
  assert.deepEqual(diffEventSnapshots(before, after).map((event) => event.type), ['E2']);
  assert.deepEqual(diffEventSnapshots(after, after), []);
});

test('a newly imported ghost produces arrival and wisp beats', () => {
  const before = snapshotSessions([], null, 0, 'run-a', NOW);
  const after = snapshotSessions([session('ghost', true)], null, 0.2, 'run-a', NOW);
  assert.deepEqual(diffEventSnapshots(before, after).map((event) => event.type), ['E1', 'E3']);
  const aged = snapshotSessions(
    [session('ghost', true)],
    null,
    0.2,
    'run-a',
    NOW + LIVE_SESSION_WINDOW_MS + 1,
  );
  assert.deepEqual(diffEventSnapshots(after, aged), []);
});

test('switching run-group context rebaselines without synthetic events', () => {
  const before = snapshotSessions([session('old')], null, 2.4, 'run-a', NOW);
  const after = snapshotSessions([session('new')], null, 8.1, 'run-b', NOW);
  assert.deepEqual(diffEventSnapshots(before, after), []);
});
