// Current Claude pricing (as of April 2026), per 1M tokens
const PRICING = {
  'claude-opus-4-6': { input: 15, output: 75, cacheCreate: 18.75, cacheRead: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5-20250514': { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheCreate: 1.25, cacheRead: 0.1 },
};

const DEFAULT_PRICING = { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 };

function pickPricing(model) {
  if (!model) return DEFAULT_PRICING;
  if (PRICING[model]) return PRICING[model];
  if (model.includes('opus')) return PRICING['claude-opus-4-6'];
  if (model.includes('haiku')) return PRICING['claude-haiku-4-5-20251001'];
  if (model.includes('sonnet')) return PRICING['claude-sonnet-4-6'];
  return DEFAULT_PRICING;
}

export function calculateCost(model, inputTokens, outputTokens, cacheCreation = 0, cacheRead = 0) {
  const pricing = pickPricing(model);
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheCreation / 1_000_000) * pricing.cacheCreate +
    (cacheRead / 1_000_000) * pricing.cacheRead;
  return parseFloat(cost.toFixed(6));
}
