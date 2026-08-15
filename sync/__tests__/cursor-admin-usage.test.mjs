import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { scanCursorSessions } from '../parse-cursor.mjs';
import {
  applyCursorUsageEvents,
  enrichCursorSessions,
  fetchCursorUsageEvents,
  sanitizeCursorText,
} from '../cursor-admin-usage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECTS = join(HERE, '..', '__fixtures__', 'cursor', 'projects');
const ADMIN = join(HERE, '..', '__fixtures__', 'cursor-admin');
const PARENT_ID = '11111111-1111-4111-8111-111111111111';
const FIXTURE_KEY = 'crsr_test_fixture_key_not_real';

function loadFixture(name) {
  return JSON.parse(readFileSync(join(ADMIN, name), 'utf8'));
}

function localSessions() {
  return scanCursorSessions(PROJECTS);
}

function mockResponse({ status = 200, body, statusText = 'OK' }) {
  return {
    status,
    statusText,
    json: async () => body,
  };
}

function captureLogs(fn) {
  const lines = [];
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...args) => { lines.push(args.map(String).join(' ')); };
  console.warn = (...args) => { lines.push(args.map(String).join(' ')); };
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    })
    .then((result) => ({ result, lines: lines.join('\n') }));
}

test('successful enrichment assigns only exact conversationId matches', async () => {
  const payload = loadFixture('success.json');
  const { result, lines } = await captureLogs(() => enrichCursorSessions(localSessions(), {
    apiKey: FIXTURE_KEY,
    fetchImpl: async () => mockResponse({ body: payload }),
  }));

  const parent = result.sessions.find((session) => session.composer_id === PARENT_ID);
  const sub = result.sessions.find((session) => session.composer_id === '22222222-2222-4222-8222-222222222222');
  assert.equal(result.report.status, 'ok');
  assert.equal(result.report.matched_sessions, 1);
  assert.equal(result.report.matched_events, 2);
  assert.equal(result.report.unmatched_events, 2);
  assert.equal(parent.usage_available, true);
  assert.equal(parent.model, 'claude-4.5-sonnet');
  assert.equal(parent.input_tokens, 326);
  assert.equal(parent.output_tokens, 500);
  assert.equal(parent.cache_creation_tokens, 80);
  assert.equal(parent.cache_read_tokens, 30);
  assert.equal(parent.total_tokens, 936);
  assert.equal(parent.estimated_cost_usd, 0.18);
  assert.equal(parent.pricing_source, 'cursor-admin-api');
  assert.equal(sub.usage_available, false);
  assert.equal(sub.model, null);
  assert.equal(sub.total_tokens, 0);

  const unmatchedModels = result.report.unmatched.by_model.map((row) => row.key).sort();
  assert.deepEqual(unmatchedModels, ['composer-2', 'gpt-5']);
  assert.equal(result.report.unmatched.totals.events, 2);
  assert.equal(JSON.stringify(result.report).includes(FIXTURE_KEY), false);
  assert.equal(lines.includes(FIXTURE_KEY), false);
});

test('missing credential leaves local sessions unchanged and does not fetch', async () => {
  const sessions = localSessions();
  let called = 0;
  const { result } = await captureLogs(() => enrichCursorSessions(sessions, {
    apiKey: '   ',
    fetchImpl: async () => {
      called += 1;
      throw new Error('should not fetch');
    },
  }));

  assert.equal(called, 0);
  assert.equal(result.report.enabled, false);
  assert.equal(result.report.status, 'missing-credential');
  assert.equal(result.sessions.every((session) => session.usage_available === false), true);
  assert.equal(result.sessions.every((session) => session.model === null), true);
});

test('malformed payload does not assign usage', async () => {
  const { result } = await captureLogs(() => enrichCursorSessions(localSessions(), {
    apiKey: FIXTURE_KEY,
    fetchImpl: async () => mockResponse({ body: loadFixture('malformed.json') }),
  }));

  assert.equal(result.report.status, 'malformed');
  assert.equal(result.report.matched_sessions, 0);
  assert.equal(result.sessions.every((session) => session.usage_available === false), true);
  assert.equal(JSON.stringify(result.report).includes(FIXTURE_KEY), false);
});

test('rate-limit response stops enrichment without assigning events', async () => {
  const { result } = await captureLogs(() => enrichCursorSessions(localSessions(), {
    apiKey: FIXTURE_KEY,
    fetchImpl: async () => mockResponse({
      status: 429,
      statusText: 'Too Many Requests',
      body: loadFixture('rate-limit.json'),
    }),
  }));

  assert.equal(result.report.status, 'rate-limit');
  assert.equal(result.report.matched_sessions, 0);
  assert.equal(result.sessions.every((session) => session.usage_available === false), true);
});

test('unmappable records stay in aggregate Cursor usage', () => {
  const sessions = localSessions();
  const { report } = applyCursorUsageEvents(sessions, [
    {
      conversationId: '33333333-3333-4333-8333-333333333333',
      model: 'composer-2',
      tokenUsage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
      chargedCents: 2,
    },
    {
      model: 'gpt-5',
      chargedCents: 8,
    },
    {
      conversationId: PARENT_ID,
      cloudAgentId: 'bc-does-not-exist',
      model: 'claude-4.5-sonnet',
      tokenUsage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
      chargedCents: 1,
    },
  ]);

  const parent = sessions.find((session) => session.composer_id === PARENT_ID);
  assert.equal(parent.usage_available, true);
  assert.equal(parent.input_tokens, 1);
  assert.equal(report.unmatched_events, 2);
  assert.equal(report.unmatched.totals.events, 2);
  assert.equal(report.unmatched.by_model.some((row) => row.key === 'composer-2'), true);
  assert.equal(report.unmatched.by_model.some((row) => row.key === 'gpt-5'), true);
  assert.equal(sessions.find((session) => session.composer_id === '22222222-2222-4222-8222-222222222222').usage_available, false);
});

test('known explicit identifier variants still require exact equality', () => {
  for (const field of ['conversationId', 'conversation_id', 'coversation_id', 'cloudAgentId', 'cloud_agent_id']) {
    const sessions = localSessions();
    applyCursorUsageEvents(sessions, [{
      [field]: PARENT_ID,
      model: 'claude-4.5-sonnet',
      tokenUsage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, totalCents: 1 },
    }]);
    const parent = sessions.find((session) => session.composer_id === PARENT_ID);
    assert.equal(parent.usage_available, true, `expected exact ${field} match`);
  }
});

test('ambiguous exact matches are not assigned to either session', () => {
  const clone = localSessions();
  const parent = clone.find((session) => session.composer_id === PARENT_ID);
  const other = clone.find((session) => session.composer_id !== PARENT_ID);
  other.composer_id = PARENT_ID;
  other.conversation_id = PARENT_ID;
  const { report } = applyCursorUsageEvents(clone, [{
    conversationId: PARENT_ID,
    model: 'claude-4.5-sonnet',
    chargedCents: 9,
    tokenUsage: { inputTokens: 3, outputTokens: 3, cacheWriteTokens: 0, cacheReadTokens: 0 },
  }]);

  assert.ok(parent);
  assert.equal(report.matched_sessions, 0);
  assert.equal(report.unmatched_events, 1);
  assert.equal(clone.every((session) => session.usage_available === false), true);
});

test('fetchCursorUsageEvents never returns the credential in errors', async () => {
  const fetched = await fetchCursorUsageEvents({
    apiKey: FIXTURE_KEY,
    fetchImpl: async () => { throw new Error(`network down for ${FIXTURE_KEY}`); },
  });
  assert.equal(fetched.ok, false);
  assert.equal(fetched.status, 'error');
  assert.equal(String(fetched.error).includes(FIXTURE_KEY), false);
  assert.equal(sanitizeCursorText(`Authorization Basic abcdef ${FIXTURE_KEY}`, FIXTURE_KEY).includes(FIXTURE_KEY), false);
});

test('mixed official models on one conversation do not pick a parent model', () => {
  const sessions = localSessions();
  applyCursorUsageEvents(sessions, [
    {
      conversationId: PARENT_ID,
      model: 'claude-4.5-sonnet',
      chargedCents: 4,
      tokenUsage: { inputTokens: 2, outputTokens: 2, cacheWriteTokens: 0, cacheReadTokens: 0 },
    },
    {
      conversationId: PARENT_ID,
      model: 'gpt-5',
      chargedCents: 6,
      tokenUsage: { inputTokens: 3, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
    },
  ]);
  const parent = sessions.find((session) => session.composer_id === PARENT_ID);
  assert.equal(parent.usage_available, true);
  assert.equal(parent.model, null);
  assert.equal(parent.total_tokens, 8);
  assert.equal(parent.estimated_cost_usd, 0.1);
});
