import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let instance = 0;
async function queries(t, sessions, respond) {
  t.mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(url, 'http://localhost').pathname;
    const override = respond?.(path, new URL(url, 'http://localhost'));
    if (override) return { ok: override.status === 200, status: override.status, json: async () => override.data };
    const data = path === '/sync/status' ? { ok: true }
      : path === '/data/sessions.json' ? sessions : null;
    return { ok: data !== null, status: data === null ? 404 : 200, json: async () => data };
  });
  const source = (await readFile(new URL('../../src/lib/queries.js', import.meta.url), 'utf8'))
    .replaceAll('import.meta.env.VITE_LOCAL_SYNC_URL', 'undefined');
  return import(`data:text/javascript;base64,${Buffer.from(`${source}\n// ${instance++}`).toString('base64')}`);
}

function session(id, endedAt, tokens = 100) {
  return { session_id: id, ended_at: endedAt, started_at: endedAt, project: 'fixture', source: 'codex', total_tokens: tokens, estimated_cost_usd: tokens / 100, tools: {} };
}

test('browser boundary preserves unavailable usage and costs, including observed zero', async (t) => {
  const q = await queries(t, [
    { ...session('missing', '2026-10-01T10:00:00Z'), usage_available: false, estimated_cost_usd: null, total_tokens: null },
    { ...session('old-inferred', '2026-10-01T10:00:00Z'), pricing_source: 'unknown', estimated_cost_usd: 999 },
    { ...session('free', '2026-10-01T10:00:00Z'), observed_cost_usd: 0 },
  ]);
  const rows = await q.fetchAllSessions();
  assert.equal(rows[0].total_tokens, null);
  assert.equal(rows[0].estimated_cost_usd, null);
  assert.equal(rows[1].estimated_cost_usd, null);
  assert.equal(rows[2].observed_cost_usd, 0);
  assert.equal(q.computeOverviewStats(rows.slice(0, 2)).periodCost, null);
  assert.equal(q.getModelBreakdown(rows.slice(0, 2))[0].cost, null);
});

test('rolling seven-day data and chart include the oldest partial day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T12:00:00Z') });
  const q = await queries(t, [session('oldest', '2026-09-26T13:00:00Z', 900), session('today', '2026-10-03T11:00:00Z', 100)]);
  const sessions = await q.fetchSessions(7);
  const chart = q.fillMissingDays(q.buildDailyFromSessions(sessions), 7);
  assert.equal(chart.reduce((sum, day) => sum + day.total_tokens, 0), 1000);
});

test('hourly chart uses exact session timestamps across midnight, not today rollup', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T00:30:00Z') });
  const q = await queries(t, [session('within-hour', '2026-10-02T23:45:00Z', 100), session('too-old', '2026-10-02T18:00:00Z', 900)]);
  const chart = await q.fetchDailyStats('1h', { daily_summary: [{ date: '2026-10-03', total_tokens: 9999 }] });
  assert.equal(chart.reduce((sum, day) => sum + day.total_tokens, 0), 100);
});

test('range uses started time when ended time is missing and excludes future records', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T12:00:00Z') });
  const ongoing = session('ongoing', '2026-10-03T11:45:00Z');
  delete ongoing.ended_at;
  const q = await queries(t, [ongoing, session('future', '2026-10-04T12:00:00Z')]);
  assert.deepEqual((await q.fetchSessions('1h')).map((row) => row.session_id), ['ongoing']);
});

test('archive range follows pinned pagination and never keeps a partially failed chain', async (t) => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const rows = [session('first', '2026-10-03T11:00:00Z'), session('second', '2026-10-02T11:00:00Z')];
  let fail = false;
  const q = await queries(t, [rows[0]], (path, url) => {
    if (path !== '/session-history/sessions') return;
    assert.equal(url.searchParams.get('from'), '2026-09-26T12:00:00.000Z');
    assert.equal(url.searchParams.get('to'), '2026-10-03T12:00:00.000Z');
    if (url.searchParams.has('cursor')) {
      assert.equal(url.searchParams.get('expectedVersion'), 'fixture-v1');
      return fail ? { status: 409, data: {} } : { status: 200, data: { items: [rows[1]], total: 2, archiveVersion: 'fixture-v1' } };
    }
    return { status: 200, data: { items: [rows[0]], total: 2, nextCursor: 'next', archiveVersion: 'fixture-v1' } };
  });
  assert.deepEqual((await q.fetchRangeSessions(7, now)).items.map((row) => row.session_id), ['first', 'second']);
  fail = true;
  const fallback = await q.fetchRangeSessions(7, now);
  assert.equal(fallback.completeness, 'preview');
  assert.deepEqual(fallback.items.map((row) => row.session_id), ['first']);
});

test('an old archive endpoint without a snapshot version is preview-only', async (t) => {
  const q = await queries(t, [session('preview', '2026-10-03T11:00:00Z')], (path) => path === '/session-history/sessions'
    ? { status: 200, data: { items: [session('unversioned', '2026-10-03T11:00:00Z')], total: 1 } } : undefined);
  const result = await q.fetchRangeSessions(7, Date.parse('2026-10-03T12:00:00Z'));
  assert.equal(result.completeness, 'preview');
  assert.deepEqual(result.items.map((row) => row.session_id), ['preview']);
});

test('all archive consumers pin the first page to published totals and reject a newer working archive', async (t) => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const old = session('published', '2026-10-03T11:00:00Z');
  let staleHelper = false;
  const q = await queries(t, [], (path, url) => {
    if (path.endsWith('/snapshot.json')) return { status: 200, data: {
      schemaVersion: 1, generation: { id: 'published-generation' }, sessions: [old],
      summary: { archive: { version: 'published-v1', snapshotBytes: 123 }, allTime: { sessions: 1 } },
    } };
    if (path.endsWith('/session-history/sessions')) {
      assert.equal(url.searchParams.get('expectedVersion'), 'published-v1');
      assert.equal(url.searchParams.get('snapshotBytes'), '123');
      return { status: 200, data: staleHelper
        ? { items: [old, session('unpublished', old.ended_at)], total: 2, archiveVersion: 'working-v2' }
        : { items: [old], total: 1, archiveVersion: 'published-v1' } };
    }
  });
  const [range, summary] = await Promise.all([q.fetchRangeSessions(7, now), q.fetchCostSummary()]);
  assert.equal(range.items.length, summary.allTime.sessions);
  assert.equal(range.completeness, 'archive');
  staleHelper = true;
  assert.equal(await q.fetchSessionPage({ limit: 10 }), null);
  for (const result of await Promise.all([
    q.fetchRangeSessions(7, now), q.fetchSessionWindow('2026-10-01T00:00:00Z', new Date(now).toISOString()),
  ])) {
    assert.equal(result.completeness, 'preview');
    assert.deepEqual(result.items.map(row => row.session_id), ['published']);
  }
});

test('fallback filters preserve date, project, source, and model together', async (t) => {
  const q = await queries(t, []);
  const now = Date.parse('2026-10-03T12:00:00Z');
  const rows = [session('match', '2026-10-03T11:00:00Z'), session('old', '2026-09-01T00:00:00Z'), { ...session('other', '2026-10-03T11:00:00Z'), project: 'other' }];
  const filters = q.getSessionFilters(7, now, { project: 'fixture', source: 'codex', model: '' });
  assert.deepEqual(q.filterSessionScope(rows, filters).map((row) => row.session_id), ['match']);
  assert.equal(q.filterSessionScope(rows, { ...filters, model: 'missing' }).length, 0);
  assert.match(q.getSessionFilters(7, now, { from: '2026-10-04', to: '2026-10-03' }).error, /before/);
});

test('sessions and cost share one generation; failed validation retains only the last good pair', async (t) => {
  let reads = 0;
  let fail = false;
  const q = await queries(t, [session('legacy', '2026-10-03T10:00:00Z')], (path) => {
    if (path.endsWith('/snapshot.json')) {
      reads++;
      return fail ? { status: 503, data: {} } : { status: 200, data: { schemaVersion: 1, generation: { id: 'g1' }, sessions: [session('verified', '2026-10-03T11:00:00Z')], summary: { allTime: { cost: 42 } }, lastGood: false } };
    }
  });
  const [sessions, summary] = await Promise.all([q.fetchAllSessions(), q.fetchCostSummary()]);
  assert.equal(reads, 1);
  assert.equal(sessions[0].session_id, 'verified');
  assert.equal(summary.allTime.cost, 42);
  fail = true;
  q.invalidateRealSessions();
  const [oldSessions, oldSummary] = await Promise.all([q.fetchAllSessions(), q.fetchCostSummary()]);
  assert.equal(reads, 2);
  assert.equal(oldSessions[0].session_id, 'verified');
  assert.equal(oldSummary.allTime.cost, 42);
  assert.equal(oldSummary.snapshot.state, 'last-good');
});

test('invalid first snapshot never falls through to unrelated legacy data', async (t) => {
  const q = await queries(t, [session('wrong-generation', '2026-10-03T10:00:00Z')], (path) => path.endsWith('/snapshot.json') ? { status: 503, data: {} } : undefined);
  assert.deepEqual(await q.fetchAllSessions(), []);
  assert.equal((await q.fetchCostSummary()).snapshot.state, 'unavailable');
});

test('review endpoint failure is unavailable, while a successfully empty queue is empty', async (t) => {
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(url).pathname;
    const bad = path === '/loop-eng/proposals' && fail;
    const data = path === '/loop-eng/summary' ? { total: 0, counts_by_status: {}, open_per_loop: {} } : [];
    return { ok: !bad, json: async () => data };
  });
  const source = (await readFile(new URL('../../src/lib/loop-api.js', import.meta.url), 'utf8')).replaceAll('import.meta.env.VITE_LOCAL_SYNC_URL', 'undefined');
  const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const unavailable = await api.fetchLoopReviewData();
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.error, /proposals/);
  fail = false;
  const empty = await api.fetchLoopReviewData();
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.proposals, []);
});
