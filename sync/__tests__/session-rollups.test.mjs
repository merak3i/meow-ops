import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSessionRollups } from '../session-rollups.mjs';

function session(id, endedAt, overrides = {}) {
  return {
    session_id: id,
    ended_at: endedAt,
    project: 'meow-ops',
    source: 'codex',
    model: 'gpt-5',
    total_tokens: 100,
    input_tokens: 40,
    output_tokens: 30,
    cache_creation_tokens: 20,
    cache_read_tokens: 10,
    estimated_cost_usd: 1.5,
    duration_seconds: 60,
    ...overrides,
  };
}

test('builds complete time and dimension rollups with tokens, time, and cost', () => {
  const rollups = buildSessionRollups([
    session('a', '2025-12-31T20:00:00Z', { project: 'alpha', source: 'claude', model: 'opus' }),
    session('b', '2026-01-01T10:00:00Z', { project: 'beta', total_tokens: 200, estimated_cost_usd: 2.5, duration_seconds: 120 }),
    session('c', '2026-02-02T10:00:00Z', { project: 'alpha', total_tokens: 300, estimated_cost_usd: 3.5, duration_seconds: 180 }),
  ], { timeZone: 'UTC', generatedAt: '2026-07-16T00:00:00.000Z' });

  assert.equal(rollups.allTime.sessions, 3);
  assert.equal(rollups.allTime.tokens, 600);
  assert.equal(rollups.allTime.cost, 7.5);
  assert.equal(rollups.allTime.duration_seconds, 360);
  assert.equal(rollups.allTime.distinct_projects, 2);
  assert.deepEqual(rollups.daily.map((row) => row.key), ['2025-12-31', '2026-01-01', '2026-02-02']);
  assert.deepEqual(rollups.monthly.map((row) => row.key), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(rollups.yearly.map((row) => row.key), ['2025', '2026']);
  assert.equal(rollups.byProject.find((row) => row.key === 'alpha').sessions, 2);
  assert.equal(rollups.bySource.find((row) => row.key === 'codex').sessions, 2);
  assert.equal(rollups.byModel.find((row) => row.key === 'gpt-5').tokens, 500);
});
