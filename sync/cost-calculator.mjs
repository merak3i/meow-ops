// Current Claude pricing (as of April 2026), per 1M tokens
const PRICING = {
  // Claude models
  'claude-opus-4-6': { input: 15, output: 75, cacheCreate: 18.75, cacheRead: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5-20250514': { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheCreate: 1.25, cacheRead: 0.1 },
  // OpenAI models (Codex Desktop)
  'gpt-4o': { input: 2.5, output: 10, cacheCreate: 0, cacheRead: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheCreate: 0, cacheRead: 0.075 },
  'gpt-5': { input: 2.5, output: 10, cacheCreate: 0, cacheRead: 1.25 },
  'o3': { input: 10, output: 40, cacheCreate: 0, cacheRead: 2.5 },
  'o4-mini': { input: 1.1, output: 4.4, cacheCreate: 0, cacheRead: 0.275 },
};

const DEFAULT_CLAUDE_PRICING = { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 };
const DEFAULT_PRICING = DEFAULT_CLAUDE_PRICING;

function pickPricing(model) {
  if (!model) return DEFAULT_PRICING;
  if (PRICING[model]) return PRICING[model];
  // Claude model matching
  if (model.includes('opus')) return PRICING['claude-opus-4-6'];
  if (model.includes('haiku')) return PRICING['claude-haiku-4-5-20251001'];
  if (model.includes('sonnet')) return PRICING['claude-sonnet-4-6'];
  // OpenAI model matching
  if (model.includes('gpt-4o-mini')) return PRICING['gpt-4o-mini'];
  if (model.includes('gpt-4o') || model.includes('gpt-5')) return PRICING['gpt-4o'];
  if (model.startsWith('o3')) return PRICING['o3'];
  if (model.startsWith('o4')) return PRICING['o4-mini'];
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
