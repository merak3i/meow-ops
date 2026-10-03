import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyInsights, weeklyEvidenceWindow } from '../../src/lib/weekly-insights.mjs';

function fixture(id, time, overrides = {}) {
  return {
    session_id: id, source: 'codex', project: 'Meow Ops',
    started_at: time, ended_at: time, duration_seconds: 900,
    user_message_count: 2, tools: {}, is_ghost: false,
    ...overrides,
  };
}

function atOffset(iso, milliseconds) {
  return new Date(Date.parse(iso) + milliseconds).toISOString();
}

test('weekly window starts Monday locally and compares the same elapsed slice a week earlier', () => {
  const now = new Date(2026, 9, 3, 12, 30, 0);
  const range = weeklyEvidenceWindow(now);
  const start = new Date(range.currentStart);
  const priorStart = new Date(range.previousStart);
  const priorEnd = new Date(range.previousEnd);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getHours(), 0);
  assert.equal(priorStart.getDay(), 1);
  assert.equal(priorEnd.getHours(), now.getHours());
  assert.equal(priorEnd.getMinutes(), now.getMinutes());
  assert.equal(Date.parse(range.to), now.getTime());
});

test('repeated patterns use independent top-level source-qualified sessions and exclude duplicate exports', () => {
  const now = new Date(2026, 9, 3, 12, 30, 0);
  const range = weeklyEvidenceWindow(now);
  const currentTime = atOffset(range.currentStart, 60_000);
  const duplicate = fixture('same-id', currentTime, { is_ghost: true });
  const otherSource = fixture('same-id', currentTime, { source: 'claude', is_ghost: true });
  const child = fixture('child', currentTime, { is_subagent: true, parent_session_id: 'parent', is_ghost: true });
  const prior = fixture('prior-ghost', atOffset(range.previousStart, 60_000), { is_ghost: true });
  const result = buildWeeklyInsights([
    duplicate, { ...duplicate, total_tokens: 999 }, otherSource, child,
    fixture('current-second', atOffset(range.currentStart, 120_000), { is_ghost: true }),
    prior,
  ], {
    now, completeness: 'archive', sourceCoverage: { codex: { state: 'collected' }, cursor: { state: 'not-configured' } },
  });
  const ghosts = result.cards.find((item) => item.id === 'no-assistant-output');
  assert.equal(ghosts.sessionCount, 3);
  assert.equal(ghosts.previousCount, 1);
  assert.equal(ghosts.evidence.length, 3);
  assert.equal(result.observedSessions, 3);
  assert.ok(result.coverageWarnings.some((warning) => warning.startsWith('cursor:')));
  assert.match(result.message, /not proof/);
});

test('child-agent records support parent workflow evidence without inflating independent session counts', () => {
  const now = new Date(2026, 9, 3, 12, 30, 0);
  const range = weeklyEvidenceWindow(now);
  const time = atOffset(range.currentStart, 1_000);
  const result = buildWeeklyInsights([
    fixture('parent-a', time),
    fixture('child-a', time, { parent_session_id: 'parent-a', is_subagent: true }),
    fixture('parent-b', time),
    fixture('child-b', time, { parent_session_id: 'parent-b', is_subagent: true }),
  ], { now, completeness: 'archive' });
  assert.equal(result.observedSessions, 2);
  const orchestration = result.cards.find((item) => item.id === 'parent-child-work');
  assert.equal(orchestration.sessionCount, 2);
  assert.equal(orchestration.evidence.length, 2);
  assert.doesNotMatch(`${orchestration.what} ${orchestration.why}`, /passed|succeeded|shipped|learned/i);
});

test('preview and unavailable archive coverage abstain instead of inferring missing patterns', () => {
  const now = new Date(2026, 9, 3, 12, 30, 0);
  const range = weeklyEvidenceWindow(now);
  const rows = [
    fixture('ghost-1', atOffset(range.currentStart, 1_000), { is_ghost: true }),
    fixture('ghost-2', atOffset(range.currentStart, 2_000), { is_ghost: true }),
  ];
  const result = buildWeeklyInsights(rows, { now, completeness: 'preview' });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.cards, []);
  assert.match(result.message, /cannot verify recurring/);
});

test('fewer than two distinct parent sessions never produces a recurring card', () => {
  const now = new Date(2026, 9, 3, 12, 30, 0);
  const range = weeklyEvidenceWindow(now);
  const result = buildWeeklyInsights([
    fixture('only-one', atOffset(range.currentStart, 1_000), { is_ghost: true }),
    fixture('only-one', atOffset(range.currentStart, 1_000), { is_ghost: true }),
  ], { now, completeness: 'archive' });
  assert.equal(result.status, 'no-repeated-patterns');
  assert.deepEqual(result.cards, []);
});

test('exact bounded archive query returns matching complete pages and preview fallback as a whole', async (t) => {
  let instance = 0;
  async function loadQueries(respond, preview = []) {
    t.mock.method(globalThis, 'fetch', async (url) => {
      const parsed = new URL(url, 'http://localhost');
      const response = respond?.(parsed.pathname, parsed);
      if (response) return { ok: response.status === 200, status: response.status, json: async () => response.data };
      const data = parsed.pathname === '/sync/status' ? { ok: true }
        : parsed.pathname === '/data/sessions.json' ? preview : null;
      return { ok: data !== null, status: data === null ? 404 : 200, json: async () => data };
    });
    const { readFile } = await import('node:fs/promises');
    const source = (await readFile(new URL('../../src/lib/queries.js', import.meta.url), 'utf8'))
      .replaceAll('import.meta.env.VITE_LOCAL_SYNC_URL', 'undefined');
    return import(`data:text/javascript;base64,${Buffer.from(`${source}\n// ${instance++}`).toString('base64')}`);
  }

  const now = new Date(2026, 9, 3, 12, 30, 0);
  const range = weeklyEvidenceWindow(now);
  const first = fixture('first', atOffset(range.currentStart, 1_000));
  const second = fixture('second', atOffset(range.previousStart, 1_000));
  const queries = await loadQueries((path, url) => {
    if (path !== '/session-history/sessions') return undefined;
    assert.equal(url.searchParams.get('from'), range.from);
    assert.equal(url.searchParams.get('to'), range.to);
    return { status: 200, data: { items: [first, second], total: 2, archiveVersion: 'pinned-v1' } };
  });
  const result = await queries.fetchSessionWindow(range.from, range.to);
  assert.equal(result.completeness, 'archive');
  assert.equal(result.archiveVersion, 'pinned-v1');
  assert.equal(result.items.length, 2);

  const fallbackQueries = await loadQueries((path) => path === '/session-history/sessions' ? { status: 409, data: {} } : undefined, [first]);
  const fallback = await fallbackQueries.fetchSessionWindow(range.from, range.to);
  assert.equal(fallback.completeness, 'preview');
  assert.deepEqual(fallback.items.map((item) => item.session_id), ['first']);
});
