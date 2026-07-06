// Current pricing (as of April 2026), per 1M tokens
const PRICING = {
  // Claude models
  'claude-opus-4-6':          { input: 15,   output: 75,   cacheCreate: 18.75, cacheRead: 1.5   },
  'claude-sonnet-4-6':        { input: 3,    output: 15,   cacheCreate: 3.75,  cacheRead: 0.3   },
  'claude-sonnet-4-5-20250514': { input: 3,  output: 15,   cacheCreate: 3.75,  cacheRead: 0.3   },
  'claude-haiku-4-5-20251001':{ input: 1,    output: 5,    cacheCreate: 1.25,  cacheRead: 0.1   },
  // OpenAI models (Codex Desktop)
  'gpt-4o':                   { input: 2.5,  output: 10,   cacheCreate: 0,     cacheRead: 1.25  },
  'gpt-4o-mini':              { input: 0.15, output: 0.6,  cacheCreate: 0,     cacheRead: 0.075 },
  'gpt-5':                    { input: 2.5,  output: 10,   cacheCreate: 0,     cacheRead: 1.25  },
  'o3':                       { input: 10,   output: 40,   cacheCreate: 0,     cacheRead: 2.5   },
  'o4-mini':                  { input: 1.1,  output: 4.4,  cacheCreate: 0,     cacheRead: 0.275 },
  // Google Gemini models
  'gemini-3-pro':             { input: 2.0,  output: 12,   cacheCreate: 0,     cacheRead: 0.20  },
  'gemini-3-flash':           { input: 0.15, output: 0.60, cacheCreate: 0,     cacheRead: 0.04  },
  'gemini-2.5-pro':           { input: 1.25, output: 10,   cacheCreate: 0,     cacheRead: 0.31  },
  'gemini-2.5-flash':         { input: 0.30, output: 2.50, cacheCreate: 0,     cacheRead: 0.075 },
  'gemini-2.0-flash':         { input: 0.10, output: 0.40, cacheCreate: 0,     cacheRead: 0.025 },
  'gemini-1.5-pro':           { input: 1.25, output: 5,    cacheCreate: 0,     cacheRead: 0.31  },
  'gemini-1.5-flash':         { input: 0.075,output: 0.30, cacheCreate: 0,     cacheRead: 0.01  },
  // Mistral models
  'mistral-large':            { input: 2.0,  output: 6.0,  cacheCreate: 0,     cacheRead: 0     },
  'mistral-small':            { input: 0.1,  output: 0.3,  cacheCreate: 0,     cacheRead: 0     },
  // Llama (local inference — cost = $0, electricity excluded)
  'llama-3.3-70b':            { input: 0,    output: 0,    cacheCreate: 0,     cacheRead: 0     },

  // DeepSeek (deepseek.com) — as of April 2026
  'deepseek-chat':            { input: 0.27, output: 1.10, cacheCreate: 0,     cacheRead: 0.07  },
  'deepseek-v3':              { input: 0.27, output: 1.10, cacheCreate: 0,     cacheRead: 0.07  },
  'deepseek-r1':              { input: 0.55, output: 2.19, cacheCreate: 0,     cacheRead: 0.14  },

  // Qwen / Alibaba DashScope
  'qwen-max':                 { input: 1.60, output: 6.40, cacheCreate: 0,     cacheRead: 0     },
  'qwen-plus':                { input: 0.40, output: 1.20, cacheCreate: 0,     cacheRead: 0     },
  'qwen-turbo':               { input: 0.05, output: 0.15, cacheCreate: 0,     cacheRead: 0     },

  // Moonshot / Kimi
  'kimi-k2':                  { input: 0.60, output: 2.50, cacheCreate: 0,     cacheRead: 0     },

  // Zhipu GLM
  'glm-4':                    { input: 0.07, output: 0.07, cacheCreate: 0,     cacheRead: 0     },
  'glm-4-flash':              { input: 0,    output: 0,    cacheCreate: 0,     cacheRead: 0     },

  // ByteDance Doubao
  'doubao-pro':               { input: 0.008,output: 0.025,cacheCreate: 0,     cacheRead: 0     },

  // xAI Grok
  'grok-3':                   { input: 3.0,  output: 15.0, cacheCreate: 0,     cacheRead: 0     },
  'grok-3-mini':              { input: 0.30, output: 0.50, cacheCreate: 0,     cacheRead: 0     },
  'grok-2':                   { input: 2.0,  output: 10.0, cacheCreate: 0,     cacheRead: 0     },

  // Cohere Command R
  'command-r-plus':           { input: 2.50, output: 10.0, cacheCreate: 0,     cacheRead: 0     },
  'command-r':                { input: 0.15, output: 0.60, cacheCreate: 0,     cacheRead: 0     },

  // Amazon Nova
  'amazon-nova-pro':          { input: 0.80, output: 3.20, cacheCreate: 0,     cacheRead: 0     },
  'amazon-nova-lite':         { input: 0.06, output: 0.24, cacheCreate: 0,     cacheRead: 0     },
  'amazon-nova-micro':        { input: 0.035,output: 0.14, cacheCreate: 0,     cacheRead: 0     },

  // Perplexity Sonar
  'sonar-pro':                { input: 3.0,  output: 15.0, cacheCreate: 0,     cacheRead: 0     },
  'sonar':                    { input: 1.0,  output: 1.0,  cacheCreate: 0,     cacheRead: 0     },
};

const DEFAULT_CLAUDE_PRICING = { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 };
const DEFAULT_PRICING = DEFAULT_CLAUDE_PRICING;

// Map a model string to a pricing row and HOW we matched it.
//   source 'exact'   — table key hit directly
//   source 'family'  — fuzzy substring match within a known family
//   source 'default' — no model string supplied
//   source 'unknown' — model supplied but unrecognized; priced with the
//                      Claude default as a rough estimate and FLAGGED so the
//                      UI can mark it "estimated" instead of presenting a
//                      confident wrong number.
export function resolvePricing(model) {
  if (!model) return { pricing: DEFAULT_PRICING, source: 'default', key: null };
  if (PRICING[model]) return { pricing: PRICING[model], source: 'exact', key: model };

  const fam = (key) => ({ pricing: PRICING[key], source: 'family', key });

  // Claude
  if (model.includes('opus'))   return fam('claude-opus-4-6');
  if (model.includes('haiku'))  return fam('claude-haiku-4-5-20251001');
  if (model.includes('sonnet')) return fam('claude-sonnet-4-6');

  // OpenAI
  if (model.includes('gpt-4o-mini'))                        return fam('gpt-4o-mini');
  if (model.includes('gpt-4o') || model.includes('gpt-5')) return fam('gpt-4o');
  if (model.startsWith('o3'))                               return fam('o3');
  if (model.startsWith('o4'))                               return fam('o4-mini');

  // Gemini — most-specific first; no bare `flash` catch-all (it used to
  // swallow gemini-1.5-flash and any future *-flash from any vendor).
  if (model.includes('gemini-3-pro'))     return fam('gemini-3-pro');
  if (model.includes('gemini-3'))         return fam('gemini-3-flash');
  if (model.includes('gemini-2.5-flash')) return fam('gemini-2.5-flash');
  if (model.includes('gemini-2.5'))       return fam('gemini-2.5-pro');
  if (model.includes('gemini-2.0'))       return fam('gemini-2.0-flash');
  if (model.includes('gemini-1.5-flash')) return fam('gemini-1.5-flash');
  if (model.includes('gemini-1.5'))       return fam('gemini-1.5-pro');
  if (model.includes('gemini'))           return fam('gemini-2.5-pro');

  // Mistral
  if (model.includes('mistral-large') || model.includes('mistral-medium')) return fam('mistral-large');
  if (model.includes('mistral'))                            return fam('mistral-small');

  // Llama / local
  if (model.includes('llama') || model.includes('ollama'))  return fam('llama-3.3-70b');

  // DeepSeek
  if (model.includes('deepseek-r1'))                        return fam('deepseek-r1');
  if (model.includes('deepseek'))                           return fam('deepseek-v3');

  // Qwen / Alibaba
  if (model.includes('qwen-max') || model.includes('qwq'))  return fam('qwen-max');
  if (model.includes('qwen-turbo'))                         return fam('qwen-turbo');
  if (model.includes('qwen'))                               return fam('qwen-plus');

  // Moonshot / Kimi
  if (model.includes('kimi') || model.includes('moonshot')) return fam('kimi-k2');

  // Zhipu GLM
  if (model.includes('glm-4-flash'))                        return fam('glm-4-flash');
  if (model.includes('glm'))                                return fam('glm-4');

  // ByteDance Doubao
  if (model.includes('doubao'))                             return fam('doubao-pro');

  // xAI Grok
  if (model.includes('grok-3-mini'))                        return fam('grok-3-mini');
  if (model.includes('grok-3'))                             return fam('grok-3');
  if (model.includes('grok'))                               return fam('grok-2');

  // Cohere Command R
  if (model.includes('command-r-plus') || model.includes('command-r+')) return fam('command-r-plus');
  if (model.includes('command-r'))                          return fam('command-r');

  // Amazon Nova
  if (model.includes('nova-pro'))                           return fam('amazon-nova-pro');
  if (model.includes('nova-lite'))                          return fam('amazon-nova-lite');
  if (model.includes('nova'))                               return fam('amazon-nova-micro');

  // Perplexity Sonar
  if (model.includes('sonar-pro'))                          return fam('sonar-pro');
  if (model.includes('sonar'))                              return fam('sonar');

  return { pricing: DEFAULT_PRICING, source: 'unknown', key: null };
}

// Clamp a token count to a finite, non-negative number. A malformed log line
// (negative split, NaN parse) must never poison a downstream sum.
function safeTokens(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Returns true when the model string maps to a real pricing row (exact or
// family). Callers use this to flag "estimated/unknown price" sessions.
export function isKnownModel(model) {
  const { source } = resolvePricing(model);
  return source === 'exact' || source === 'family';
}

// Detailed variant: cost plus how the price was resolved. Prefer this in the
// pipeline so unknown-model sessions can be flagged rather than silently
// priced at Claude rates.
export function calculateCostDetailed(model, inputTokens, outputTokens, cacheCreation = 0, cacheRead = 0) {
  const { pricing, source } = resolvePricing(model);
  const i = safeTokens(inputTokens);
  const o = safeTokens(outputTokens);
  const cc = safeTokens(cacheCreation);
  const cr = safeTokens(cacheRead);
  const cost =
    (i / 1_000_000) * pricing.input +
    (o / 1_000_000) * pricing.output +
    (cc / 1_000_000) * pricing.cacheCreate +
    (cr / 1_000_000) * pricing.cacheRead;
  return { cost: parseFloat(cost.toFixed(6)), pricingSource: source };
}

export function calculateCost(model, inputTokens, outputTokens, cacheCreation = 0, cacheRead = 0) {
  return calculateCostDetailed(model, inputTokens, outputTokens, cacheCreation, cacheRead).cost;
}
