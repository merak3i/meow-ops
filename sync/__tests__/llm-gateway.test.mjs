import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { calculateCost } from '../cost-calculator.mjs';
import { appendRecord, readLedger } from '../loop-ledger.mjs';
import { validateLoopRun } from '../loop-schema.mjs';
import {
  callLlm,
  DEEPSEEK_MODEL,
  METER_LOOP_ID,
  resetLlmBudgetForTests,
} from '../llm-gateway.mjs';

const NOW = new Date('2026-07-06T00:00:00.000Z');

async function withTempLedger(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'meow-llm-gateway-'));
  const prev = process.env.MEOW_LOOP_DIR;
  process.env.MEOW_LOOP_DIR = dir;
  resetLlmBudgetForTests();
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.MEOW_LOOP_DIR;
    else process.env.MEOW_LOOP_DIR = prev;
    resetLlmBudgetForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeKey() {
  return ['sk', 'a'.repeat(24)].join('-');
}

function responseWith(content, usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 }) {
  return {
    ok: true,
    async json() {
      return {
        choices: [{ message: { content } }],
        usage,
      };
    },
  };
}

test('llm gateway happy path meters a successful DeepSeek JSON response', async () => {
  await withTempLedger(async () => {
    let calls = 0;
    const key = fakeKey();
    const result = await callLlm({
      template: 'loop={{loop_id}} flags={{flags}}',
      vars: { loop_id: 'demo-loop', flags: ['slower'] },
      now: NOW,
      env: {
        DEEPSEEK_API_KEY: key,
        MEOW_LLM_WEEKLY_USD: '1.00',
        MEOW_LLM_CALLS_PER_CYCLE: '25',
      },
      transport: async (url, options) => {
        calls += 1;
        assert.equal(url, 'https://api.deepseek.com/chat/completions');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.authorization, `Bearer ${key}`);
        const body = JSON.parse(options.body);
        assert.equal(body.model, DEEPSEEK_MODEL);
        assert.deepEqual(body.response_format, { type: 'json_object' });
        assert.match(body.messages[0].content, /demo-loop/);
        return responseWith(JSON.stringify({
          one_percent_target: 'Reduce flagged duration by one percent',
          rationale: 'The run is slower than its baseline on local metadata.',
          expected_benefit: 'Keeps review focused on the highest delta.',
        }));
      },
    });

    assert.equal(calls, 1);
    assert.equal(result.draft.one_percent_target, 'Reduce flagged duration by one percent');
    const runs = readLedger('run');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].loop_id, METER_LOOP_ID);
    assert.deepEqual(runs[0].sources, ['deepseek']);
    assert.equal(runs[0].metrics.total_tokens, 1200);
    assert.equal(runs[0].metrics.cost_usd_real, calculateCost(DEEPSEEK_MODEL, 1000, 200));
    assert.equal(validateLoopRun(runs[0]), runs[0]);
    assert.equal(JSON.stringify(runs).includes(key), false);
  });
});

test('llm gateway retries malformed JSON once and writes no meter run', async () => {
  await withTempLedger(async () => {
    let calls = 0;
    const notes = [];
    const result = await callLlm({
      template: 'loop={{loop_id}}',
      vars: { loop_id: 'demo-loop' },
      now: NOW,
      notes,
      env: {
        DEEPSEEK_API_KEY: fakeKey(),
        MEOW_LLM_WEEKLY_USD: '1.00',
        MEOW_LLM_CALLS_PER_CYCLE: '25',
      },
      transport: async () => {
        calls += 1;
        return responseWith('not-json');
      },
    });

    assert.equal(result, null);
    assert.equal(calls, 2);
    assert.equal(notes.at(-1), 'llm skipped: malformed json');
    assert.equal(readLedger('run').length, 0);
  });
});

test('llm gateway budget checks skip before network calls', async () => {
  await withTempLedger(async () => {
    const key = fakeKey();
    let calls = 0;
    let notes = [];
    const noKey = await callLlm({
      template: 'x',
      notes,
      env: {},
      transport: async () => {
        calls += 1;
        return responseWith('{}');
      },
      now: NOW,
    });
    assert.equal(noKey, null);
    assert.deepEqual(notes, ['llm skipped: no key']);
    assert.equal(calls, 0);

    notes = [];
    const callCap = await callLlm({
      template: 'x',
      notes,
      env: { DEEPSEEK_API_KEY: key, MEOW_LLM_CALLS_PER_CYCLE: '0' },
      transport: async () => {
        calls += 1;
        return responseWith('{}');
      },
      now: NOW,
    });
    assert.equal(callCap, null);
    assert.deepEqual(notes, ['llm skipped: call cap']);
    assert.equal(calls, 0);

    appendRecord('run', {
      run_id: 'run-seeded-meter',
      loop_id: METER_LOOP_ID,
      captured_at: NOW.toISOString(),
      sources: ['deepseek'],
      session_ids: [],
      metrics: {
        duration_seconds: 1,
        total_tokens: 1,
        cost_usd_real: 1,
        cost_usd_notional: 0,
        message_count: 2,
      },
    });

    notes = [];
    const weeklyCap = await callLlm({
      template: 'x',
      notes,
      env: { DEEPSEEK_API_KEY: key, MEOW_LLM_WEEKLY_USD: '1.00' },
      transport: async () => {
        calls += 1;
        return responseWith('{}');
      },
      now: NOW,
    });
    assert.equal(weeklyCap, null);
    assert.deepEqual(notes, ['llm skipped: weekly cap']);
    assert.equal(calls, 0);
  });
});
