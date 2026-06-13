import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCost, calculateCostDetailed, resolvePricing, isKnownModel } from '../cost-calculator.mjs';

test('exact table key resolves as exact', () => {
  const r = resolvePricing('gpt-4o');
  assert.equal(r.source, 'exact');
  assert.equal(r.key, 'gpt-4o');
});

test('family fuzzy match resolves as family', () => {
  assert.equal(resolvePricing('claude-opus-4-8').source, 'family');
  assert.equal(resolvePricing('claude-sonnet-4-6-20990101').source, 'family');
});

test('unknown model is FLAGGED, not silently priced as Sonnet', () => {
  const r = resolvePricing('totally-made-up-model-v9');
  assert.equal(r.source, 'unknown');
  assert.equal(isKnownModel('totally-made-up-model-v9'), false);
  // still returns a number (rough estimate) but the caller can mark it
  const { cost, pricingSource } = calculateCostDetailed('totally-made-up-model-v9', 1_000_000, 0);
  assert.equal(pricingSource, 'unknown');
  assert.ok(cost > 0);
});

test('the bare "flash" catch-all no longer mis-prices gemini-1.5-flash', () => {
  // Regression: includes("flash") used to swallow 1.5-flash and price it as
  // 2.0-flash (input 0.10 vs 0.075). Now each Gemini tier matches its own row.
  const r15 = resolvePricing('gemini-1.5-flash');
  assert.equal(r15.key, 'gemini-1.5-flash');
  assert.equal(resolvePricing('gemini-2.5-flash').key, 'gemini-2.5-flash');
  assert.equal(resolvePricing('gemini-3-pro').key, 'gemini-3-pro');
});

test('negative and NaN tokens are clamped to 0 — never poison a sum', () => {
  assert.equal(calculateCost('gpt-4o', -100, -50), 0);
  assert.equal(calculateCost('gpt-4o', NaN, 1000), parseFloat(((1000 / 1e6) * 10).toFixed(6)));
  assert.ok(Number.isFinite(calculateCost('gpt-4o', Infinity, 0)));
});

test('cost math is correct for a known model', () => {
  // gpt-4o: input 2.5, output 10 per 1M
  const cost = calculateCost('gpt-4o', 1_000_000, 1_000_000);
  assert.equal(cost, 12.5);
});
