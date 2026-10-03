import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCursorUsageEvents, CURSOR_USAGE_POLL_INTERVAL_MS, enrichCursorSessions, fetchCursorUsageEvents } from '../cursor-admin-usage.mjs';
import { readCursorUsageHistory, writeCursorUsageHistory } from '../cursor-usage-history.mjs';

const KEY = 'key_synthetic_fixture_only';
const HOUR = CURSOR_USAGE_POLL_INTERVAL_MS;
const response = events => ({ status: 200, json: async () => ({ usageEvents: events, pagination: { hasNextPage: false, numPages: 1 } }) });
const event = (id, timestamp, chargedCents = 4) => ({ eventId: id, conversationId: 'conversation-one', timestamp, model: 'test-model', chargedCents, tokenUsage: { inputTokens: 10, outputTokens: 3 } });
const sessions = () => [{ source: 'cursor', composer_id: 'conversation-one', model: null, usage_available: false }];
function temporaryHistory(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'meow-cursor-history-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'private', 'cursor', 'history.json');
}

test('usage history retains verified data without credentials or after failed requests and throttles hourly', async t => {
  const historyPath = temporaryHistory(t);
  let calls = 0;
  const options = { historyPath, apiKey: KEY, now: HOUR * 100, startDate: 10, endDate: 30, fetchImpl: async () => { calls++; return response([event('one', 20)]); } };
  const first = await enrichCursorSessions(sessions(), options);
  assert.equal(first.sessions[0].observed_cost_usd, 0.04);
  assert.equal(first.report.history.persisted, true);
  const cached = await enrichCursorSessions(sessions(), { ...options, now: options.now + 300_000 });
  assert.equal(cached.report.status, 'cached');
  assert.equal(calls, 1);
  const missing = await enrichCursorSessions(sessions(), { ...options, apiKey: '', now: options.now + HOUR });
  assert.equal(missing.report.status, 'missing-credential');
  assert.equal(missing.sessions[0].observed_cost_usd, 0.04);
  assert.equal(missing.report.history.freshness, 'retained');
  assert.equal(missing.report.enabled, false);
  const failure = await enrichCursorSessions(sessions(), { ...options, now: options.now + HOUR, fetchImpl: async () => { calls++; return { status: 403 }; } });
  assert.equal(failure.report.status, 'forbidden');
  assert.equal(failure.sessions[0].observed_cost_usd, 0.04);
  assert.equal(failure.report.history.last_success_at, options.now);
  await enrichCursorSessions(sessions(), { ...options, now: options.now + HOUR + 300_000 });
  assert.equal(calls, 2, 'failed attempts also respect hourly polling');
  assert.equal(readCursorUsageHistory(historyPath).events.length, 1);
});

test('overlapping and shorter periods deduplicate, accept corrected charges, and preserve prior periods', async t => {
  const historyPath = temporaryHistory(t);
  const base = { historyPath, apiKey: KEY, now: HOUR * 100, startDate: 0, endDate: 100 };
  await enrichCursorSessions(sessions(), { ...base, fetchImpl: async () => response([event('older', 20), event('recent', 80, 10), event('recent', 80, 10)]) });
  const result = await enrichCursorSessions(sessions(), { ...base, now: base.now + HOUR, startDate: 70, endDate: 100, fetchImpl: async () => response([event('recent', 80, 6)]) });
  assert.equal(result.report.totals.events, 2);
  assert.equal(result.sessions[0].observed_cost_usd, 0.1);
  assert.deepEqual(result.report.history.periods, [{ startDate: 0, endDate: 100 }]);
  const final = await enrichCursorSessions(sessions(), { ...base, now: base.now + 2 * HOUR, startDate: 200, endDate: 250, fetchImpl: async () => response([event('new', 220)]) });
  assert.equal(final.report.totals.events, 3);
  assert.equal(final.report.period, null, 'separate verified periods must not imply coverage of the gap');
  assert.deepEqual(final.report.requested_period, { startDate: 200, endDate: 250 });
  assert.deepEqual(final.report.history.periods, [{ startDate: 0, endDate: 100 }, { startDate: 200, endDate: 250 }]);
});

test('state persists only whitelisted fields privately outside the repository', async t => {
  const historyPath = temporaryHistory(t);
  await enrichCursorSessions(sessions(), { historyPath, apiKey: KEY, now: HOUR * 100, startDate: 0, endDate: 100, fetchImpl: async () => response([{ ...event('private-event', 50), userEmail: 'private-person@example.com', prompt: 'private prompt never retain', credentials: KEY, arbitrary: { secret: 'private-hidden' } }]) });
  const body = readFileSync(historyPath, 'utf8');
  for (const secret of [KEY, 'private-person@example.com', 'private prompt never retain', 'private-hidden', 'private-event']) assert.equal(body.includes(secret), false);
  assert.equal(statSync(historyPath).mode & 0o777, 0o600);
  assert.equal(statSync(join(historyPath, '..')).mode & 0o777, 0o700);
  const root = join(historyPath, '..', 'repo');
  mkdirSync(join(root, '.git'), { recursive: true });
  assert.throws(() => writeCursorUsageHistory(join(root, 'state.json'), readCursorUsageHistory(historyPath)), /outside Git worktrees/);
});

test('corrupt or symlink history fails closed without replacing evidence or issuing requests', async t => {
  const historyPath = temporaryHistory(t);
  mkdirSync(join(historyPath, '..'), { recursive: true });
  writeFileSync(historyPath, '{broken', { mode: 0o600 });
  let calls = 0;
  const result = await enrichCursorSessions(sessions(), { historyPath, apiKey: KEY, fetchImpl: async () => { calls++; return response([]); } });
  assert.equal(result.report.status, 'history-error');
  assert.equal(calls, 0);
  assert.equal(readFileSync(historyPath, 'utf8'), '{broken');
  const symlink = `${historyPath}.link`;
  symlinkSync(historyPath, symlink);
  assert.throws(() => readCursorUsageHistory(symlink), /private regular file/);
});

test('provider timeout bounds both network and JSON body reads and rejects redirects', async () => {
  for (const fetchImpl of [async () => new Promise(() => {}), async () => ({ status: 200, json: () => new Promise(() => {}) })]) {
    const result = await fetchCursorUsageEvents({ apiKey: KEY, timeoutMs: 10, fetchImpl });
    assert.equal(result.status, 'timeout');
    assert.deepEqual(result.events, []);
  }
  const redirected = await fetchCursorUsageEvents({ apiKey: KEY, fetchImpl: async (_url, init) => { assert.equal(init.redirect, 'error'); assert.ok(init.signal); return { ...response([]), redirected: true }; } });
  assert.equal(redirected.ok, false);
  for (const status of [0, 301, 307]) {
    assert.equal((await fetchCursorUsageEvents({ apiKey: KEY, fetchImpl: async () => ({ status }) })).ok, false);
  }
});

test('Grok Bot attribution requires explicit product evidence, never a Grok model name', () => {
  const { report } = applyCursorUsageEvents([], [
    { ...event('grok-model-only', 10), model: 'grok-4' },
    { ...event('real-bot', 20), model: 'different-model', requestedModel: 'requested-model', attributes: { 'cursor.surface': 'grok_bot', 'cursor.conversation.id': 'real-private-bot' }, conversationId: undefined },
  ]);
  assert.deepEqual(report.grok_bot_billing, { status: 'partial-evidence', identified_events: 1, identified_bots: 1, complete: false });
  assert.equal(report.by_product.find(row => row.key === 'unknown').events, 1);
  assert.equal(report.by_product.find(row => row.key === 'grok_bot').events, 1);
  assert.equal(JSON.stringify(report).includes('real-private-bot'), false);
});

test('unknown charges stay unavailable while actual zero remains observed zero', () => {
  const unknown = applyCursorUsageEvents(sessions(), [{ conversationId: 'conversation-one', model: 'test', tokenUsage: { inputTokens: 20, totalCents: 3 } }]);
  assert.equal(unknown.sessions[0].observed_cost_usd, null);
  assert.equal(unknown.sessions[0].estimated_cost_usd, null);
  assert.equal(unknown.sessions[0].cost_kind, 'unavailable');
  assert.equal(unknown.report.totals.observed_cost_usd, null);
  const zero = applyCursorUsageEvents(sessions(), [event('zero', 10, 0)]);
  assert.equal(zero.sessions[0].observed_cost_usd, 0);
  assert.equal(zero.sessions[0].cost_kind, 'observed');
  const missingTokens = applyCursorUsageEvents(sessions(), [{ conversationId: 'conversation-one', chargedCents: 1 }]);
  assert.equal(missingTokens.sessions[0].total_tokens, null);
  assert.equal(missingTokens.sessions[0].usage_available, false);
  for (const chargedCents of [false, true, '', '  ', [], {}]) {
    const invalid = applyCursorUsageEvents(sessions(), [{ conversationId: 'conversation-one', chargedCents }]);
    assert.equal(invalid.sessions[0].observed_cost_usd, null);
  }
});

test('exact record duplicates do not inflate usage and distinct users remain distinct', () => {
  const raw = { conversationId: 'conversation-one', timestamp: 10, model: 'test', chargedCents: 4, userEmail: 'one@example.com' };
  const result = applyCursorUsageEvents(sessions(), [raw, { ...raw }, { ...raw, userEmail: 'two@example.com' }]);
  assert.equal(result.report.totals.events, 2);
  assert.equal(result.report.deduplication.fingerprint_events, 2);
  assert.equal(result.sessions[0].observed_cost_usd, 0.08);
});

test('existing archived official charges survive first no-key run without fabricating event coverage', async () => {
  const local = [{ source: 'cursor', session_id: 'one', composer_id: 'conversation-one', usage_available: false, model: null }];
  const previousSessions = [
    { source: 'cursor', session_id: 'one', pricing_source: 'cursor-admin-api', estimated_cost_usd: 1.2, usage_available: true, total_tokens: 200, model: 'old-reported-model' },
    { source: 'claude', session_id: 'one', pricing_source: 'cursor-admin-api', estimated_cost_usd: 999 },
  ];
  const result = await enrichCursorSessions(local, { apiKey: '', previousSessions });
  assert.equal(result.sessions[0].observed_cost_usd, 1.2);
  assert.equal(result.sessions[0].estimated_cost_usd, null);
  assert.equal(result.sessions[0].total_tokens, 200);
  assert.equal(result.sessions[0].provider_usage_state, 'retained-archive');
  assert.equal(result.sessions[0].provider_cost_coverage.complete, false);
  assert.equal(result.report.retained_archive_sessions, 1);
  assert.equal(result.report.totals.observed_cost_usd, null, 'legacy session summaries are not reconstructed provider events');
  assert.equal(result.report.history.last_success_at, null);
});

test('first failed request is throttled with unavailable data, not a verified cache', async t => {
  const historyPath = temporaryHistory(t);
  const options = { apiKey: KEY, historyPath, now: HOUR * 100, fetchImpl: async () => ({ status: 429 }) };
  await enrichCursorSessions(sessions(), options);
  const next = await enrichCursorSessions(sessions(), { ...options, now: options.now + 1000 });
  assert.equal(next.report.status, 'waiting-to-retry');
  assert.equal(next.report.history.freshness, 'unavailable');
  assert.equal(next.report.totals.observed_cost_usd, null);
});

test('partial pagination and malformed rows never replace a verified billing window', async t => {
  const historyPath = temporaryHistory(t);
  const options = { historyPath, apiKey: KEY, now: HOUR * 100, startDate: 0, endDate: 100 };
  await enrichCursorSessions(sessions(), { ...options, fetchImpl: async () => response([event('original', 20, 12)]) });
  const partial = await enrichCursorSessions(sessions(), { ...options, now: options.now + HOUR, maxPages: 1, fetchImpl: async () => ({ status: 200, json: async () => ({ usageEvents: [event('incomplete', 30, 200)], pagination: { hasNextPage: true, numPages: 2 } }) }) });
  assert.equal(partial.report.status, 'page-limit');
  assert.equal(partial.sessions[0].observed_cost_usd, 0.12);
  const malformed = await enrichCursorSessions(sessions(), { ...options, now: options.now + HOUR * 2, fetchImpl: async () => response([null, event('incomplete', 30, 200)]) });
  assert.equal(malformed.report.status, 'malformed');
  assert.equal(malformed.sessions[0].observed_cost_usd, 0.12);
  assert.equal(readCursorUsageHistory(historyPath).events.length, 1);
});
