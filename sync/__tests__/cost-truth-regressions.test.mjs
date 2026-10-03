import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCostDetailed } from '../cost-calculator.mjs';
import { parseHermesRows, parseHermesModelUsageRows } from '../parse-hermes.mjs';
import { buildSessionRollups } from '../session-rollups.mjs';

test('NULL observed cost cannot replace an estimate; explicit observed zero remains separate', () => {
  const [estimated, free] = parseHermesRows([
    { id: 'estimated', model: 'gpt-4o', input_tokens: 100, estimated_cost_usd: 0.12, actual_cost_usd: null },
    { id: 'observed-zero', model: 'gpt-4o', input_tokens: 100, estimated_cost_usd: 0.12, actual_cost_usd: 0 },
  ]);
  assert.equal(estimated.estimated_cost_usd, 0.12);
  assert.equal(estimated.observed_cost_usd, null);
  assert.equal(estimated.cost_kind, 'estimated');
  assert.equal(free.estimated_cost_usd, 0.12);
  assert.equal(free.observed_cost_usd, 0);
  assert.equal(free.cost_kind, 'observed');
});

test('unknown, missing, mixed, and future model names do not invent a price', () => {
  for (const model of [null, 'unknown', 'mixed', 'gpt-5-future', 'deepseek-v99', 'claude-opus-99', 'llama-cloud-future']) {
    assert.equal(calculateCostDetailed(model, 1_000_000, 20_000).cost, null, String(model));
  }
  const [session] = parseHermesRows([{ id: 'unknown', model: 'mixed', input_tokens: 100, actual_cost_usd: null, estimated_cost_usd: null }]);
  assert.equal(session.estimated_cost_usd, null);
  assert.equal(session.cost_available, false);
  assert.equal(session.cost_kind, 'unavailable');
});

test('rollups separate estimates, observed charges, and missing coverage', () => {
  const rows = [
    { session_id: 'a', estimated_cost_usd: 1, observed_cost_usd: null },
    { session_id: 'b', estimated_cost_usd: null, observed_cost_usd: 0 },
    { session_id: 'c', estimated_cost_usd: null, observed_cost_usd: null },
  ];
  const { allTime } = buildSessionRollups(rows);
  assert.equal(allTime.cost, 1);
  assert.equal(allTime.estimated_cost_usd, 1);
  assert.equal(allTime.observed_cost_usd, 0);
  assert.equal(allTime.estimated_cost_sessions, 1);
  assert.equal(allTime.observed_cost_sessions, 1);
  assert.equal(allTime.unavailable_cost_sessions, 1);
  assert.equal(buildSessionRollups([rows[2]]).allTime.cost, null);
});

test('Hermes model usage preserves absent actual charges instead of manufacturing zero', () => {
  const usage = parseHermesModelUsageRows([
    { session_id: 'a', model: 'a', estimated_cost_usd: 0.4, actual_cost_usd: null },
    { session_id: 'b', model: 'b', estimated_cost_usd: null, actual_cost_usd: 0 },
  ]);
  assert.equal(usage.by_model.find((row) => row.model === 'a').actual_cost_usd, null);
  assert.equal(usage.by_model.find((row) => row.model === 'b').estimated_cost_usd, null);
  assert.equal(usage.totals.actual_cost_usd, 0);
  assert.equal(usage.totals.estimated_cost_usd, 0.4);
});
