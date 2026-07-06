import { performance } from 'node:perf_hooks';

import { calculateCost } from './cost-calculator.mjs';
import { appendRecord, newId, readLedger } from './loop-ledger.mjs';

export const DEEPSEEK_MODEL = 'deepseek-chat';
export const METER_LOOP_ID = 'meow-ops-assistant';

const API_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_CALL_CAP = 25;
const DEFAULT_WEEKLY_CAP_USD = 1.00;
const MAX_OUTPUT_TOKENS = 400;
const WEEK_MS = 7 * 86_400_000;
const REQUIRED_FIELDS = ['one_percent_target', 'rationale', 'expected_benefit'];

let callsThisProcess = 0;

export function resetLlmBudgetForTests() {
  callsThisProcess = 0;
}

function note(notes, value) {
  if (Array.isArray(notes)) notes.push(value);
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function intFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function weeklyCapFromEnv(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_WEEKLY_CAP_USD;
}

function formatVar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function renderTemplate(template, vars = {}) {
  return String(template).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => formatVar(vars[key]));
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function estimatedCallCostUsd(prompt) {
  return calculateCost(DEEPSEEK_MODEL, estimateTokens(prompt), MAX_OUTPUT_TOKENS);
}

function weeklyMeterSpendUsd(now) {
  const cutoff = new Date(now).getTime() - WEEK_MS;
  return readLedger('run')
    .filter((run) => run.loop_id === METER_LOOP_ID)
    .filter((run) => {
      const captured = Date.parse(run.captured_at || '');
      return Number.isFinite(captured) && captured >= cutoff;
    })
    .reduce((sum, run) => sum + nonNegativeNumber(run.metrics?.cost_usd_real), 0);
}

function budgetCheck({ env, now, prompt, notes }) {
  const key = env.DEEPSEEK_API_KEY;
  if (!key) {
    note(notes, 'llm skipped: no key');
    return null;
  }

  const callCap = intFromEnv(env.MEOW_LLM_CALLS_PER_CYCLE, DEFAULT_CALL_CAP);
  if (callsThisProcess >= callCap) {
    note(notes, 'llm skipped: call cap');
    return null;
  }

  const weeklyCap = weeklyCapFromEnv(env.MEOW_LLM_WEEKLY_USD);
  const currentSpend = weeklyMeterSpendUsd(now);
  if (currentSpend + estimatedCallCostUsd(prompt) > weeklyCap) {
    note(notes, 'llm skipped: weekly cap');
    return null;
  }

  callsThisProcess += 1;
  return key;
}

function validateDraftObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== REQUIRED_FIELDS.slice().sort().join(',')) return null;
  for (const field of REQUIRED_FIELDS) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) return null;
  }
  return {
    one_percent_target: value.one_percent_target.trim(),
    rationale: value.rationale.trim(),
    expected_benefit: value.expected_benefit.trim(),
  };
}

function parseCompletion(responseJson) {
  const content = responseJson?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  try {
    return validateDraftObject(JSON.parse(content));
  } catch {
    return null;
  }
}

function usageCounts(responseJson) {
  const usage = responseJson?.usage || {};
  const input = nonNegativeNumber(usage.prompt_tokens);
  const output = nonNegativeNumber(usage.completion_tokens);
  return {
    input,
    output,
    total: nonNegativeNumber(usage.total_tokens) || input + output,
  };
}

function appendMeterRun({ now, startedAtMs, responseJson }) {
  const usage = usageCounts(responseJson);
  const durationSeconds = Math.max(0, (performance.now() - startedAtMs) / 1000);
  return appendRecord('run', {
    run_id: newId('run'),
    loop_id: METER_LOOP_ID,
    captured_at: new Date(now).toISOString(),
    sources: ['deepseek'],
    session_ids: [],
    metrics: {
      duration_seconds: Number(durationSeconds.toFixed(3)),
      total_tokens: usage.total,
      cost_usd_real: calculateCost(DEEPSEEK_MODEL, usage.input, usage.output),
      cost_usd_notional: 0,
      message_count: 2,
    },
  });
}

async function postDeepSeek({ key, prompt, transport, signal }) {
  const response = await transport(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    signal,
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      response_format: { type: 'json_object' },
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response?.ok) {
    return { ok: false, malformed: false, responseJson: null };
  }
  try {
    return { ok: true, malformed: false, responseJson: await response.json() };
  } catch {
    return { ok: false, malformed: true, responseJson: null };
  }
}

async function oneAttempt({ env, now, prompt, transport, notes }) {
  const key = budgetCheck({ env, now, prompt, notes });
  if (!key) return { status: 'skip' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const startedAtMs = performance.now();
  try {
    const posted = await postDeepSeek({
      key,
      prompt,
      transport,
      signal: controller.signal,
    });
    if (!posted.ok) return { status: posted.malformed ? 'malformed' : 'skip' };
    const draft = parseCompletion(posted.responseJson);
    if (!draft) return { status: 'malformed' };
    const meterRun = appendMeterRun({ now, startedAtMs, responseJson: posted.responseJson });
    return { status: 'ok', draft, meterRun };
  } catch {
    return { status: 'skip' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callLlm({
  template,
  vars = {},
  env = process.env,
  transport = globalThis.fetch,
  now = new Date(),
  notes,
} = {}) {
  if (typeof transport !== 'function') {
    note(notes, 'llm skipped: no transport');
    return null;
  }
  const prompt = renderTemplate(template, vars);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await oneAttempt({ env, now, prompt, transport, notes });
    if (result.status === 'ok') return result;
    if (result.status !== 'malformed') return null;
  }
  note(notes, 'llm skipped: malformed json');
  return null;
}
