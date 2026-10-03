import { test, expect, type Page } from '@playwright/test';

const NOW = new Date('2026-10-03T12:00:00Z');
const rows: Array<{
  session_id: string; project: string; source: 'codex' | 'claude'; model: string;
  started_at: string; ended_at: string; total_tokens: number; estimated_cost_usd: number;
  tools: Record<string, number>; is_ghost?: boolean; is_subagent?: boolean;
  session_title?: string; user_message_count?: number;
}> = [
  { session_id: 'recent-alpha', project: 'alpha', source: 'codex', model: 'fixture-model', started_at: '2026-10-03T11:45:00Z', ended_at: '2026-10-03T11:45:00Z', total_tokens: 100, estimated_cost_usd: 1, tools: {} },
  { session_id: 'recent-beta', project: 'beta', source: 'claude', model: 'fixture-model', started_at: '2026-10-03T11:30:00Z', ended_at: '2026-10-03T11:30:00Z', total_tokens: 200, estimated_cost_usd: 2, tools: {} },
  { session_id: 'old-alpha', project: 'old-project', source: 'codex', model: 'fixture-model', started_at: '2026-08-01T11:30:00Z', ended_at: '2026-08-01T11:30:00Z', total_tokens: 500, estimated_cost_usd: 5, tools: {} },
];
const proposal = {
  schema_version: 1, proposal_id: 'fixture-proposal', loop_id: 'fixture-loop', created_at: NOW.toISOString(),
  created_by: 'system:propose', category: 'workflow', title: 'Fixture proposal', one_percent_target: 'A small change',
  status: 'pending_approval', evidence: [], rollback: { plan: 'Revert fixture' }, simulation_id: 'missing-result',
};
const previewOrigin = `http://127.0.0.1:${process.env.MEOW_OPS_E2E_PREVIEW_PORT || '4275'}`;

async function fixture(page: Page) {
  const state = { archiveFails: false, queueFails: false, archiveRequests: [] as URL[], weeklyRows: [] as typeof rows, learnRows: null as typeof rows | null };
  await page.clock.install({ time: NOW });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    // All helper/data responses are synthetic; no private helper or mutation runs.
    if (request.method() !== 'GET') return route.fulfill({ status: 405, json: { error: 'Fixture is read-only' } });
    if (path === '/sync/status') return route.fulfill({ json: { ok: true, state: 'succeeded', artifact: { available: true, sessions: rows.length } } });
    if (path === '/data/snapshot.json') return route.fulfill({ json: { schemaVersion: 1, generation: { id: 'fixture', createdAt: NOW.toISOString() }, sessions: state.learnRows || rows, summary: { archive: { version: 'fixture-v1', snapshotBytes: 1000, total: rows.length + state.weeklyRows.length }, allTime: { sessions: rows.length + state.weeklyRows.length, tokens: 800, cost: 8 } }, lastGood: false } });
    if (path === '/session-history/sessions') {
      state.archiveRequests.push(url);
      expect(url.searchParams.get('expectedVersion')).toBe('fixture-v1');
      expect(url.searchParams.get('snapshotBytes')).toBe('1000');
      if (state.archiveFails) return route.fulfill({ status: 503, json: { error: 'Fixture archive unavailable' } });
      const from = Date.parse(url.searchParams.get('from') || '');
      const to = Date.parse(url.searchParams.get('to') || '');
      const windowDays = (to - from) / 86_400_000;
      const sourceRows = windowDays >= 11 && windowDays <= 14 ? [...rows, ...state.weeklyRows] : state.learnRows || rows;
      const items = sourceRows.filter((row) => {
        const activity = Date.parse(row.ended_at);
        return (!url.searchParams.get('from') || activity >= Date.parse(url.searchParams.get('from')!))
          && (!url.searchParams.get('to') || activity <= Date.parse(url.searchParams.get('to')!))
          && ['project', 'source', 'model'].every((key) => !url.searchParams.get(key) || row[key as 'project' | 'source' | 'model'] === url.searchParams.get(key));
      });
      return route.fulfill({ json: { items, total: items.length, limit: 100, nextCursor: null, archiveVersion: 'fixture-v1', archive: { total: 3 }, facets: { projects: ['alpha', 'beta', 'old-project'], sources: ['claude', 'codex'], models: ['fixture-model'] } } });
    }
    if (path === '/loop-eng/summary') return route.fulfill({ json: { total: 1, counts_by_status: { pending_approval: 1 }, open_per_loop: { 'fixture-loop': 1 } } });
    if (path === '/loop-eng/proposals') return route.fulfill({ status: state.queueFails ? 503 : 200, json: [proposal] });
    if (path.startsWith('/loop-eng/')) return route.fulfill({ json: [] });
    if (path.startsWith('/data/') || url.port === '7337') return route.fulfill({ status: 404, json: {} });
    if (url.origin !== previewOrigin) return route.abort();
    return route.continue();
  });
  return state;
}

test('Sessions archive and unavailable fallback obey the same range and filters', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/#/today/sessions');
  await expect(page.getByRole('cell', { name: 'alpha', exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'old-project', exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '1h', exact: true }).click();
  await expect.poll(() => {
    const query = state.archiveRequests.at(-1)?.searchParams;
    return Date.parse(query?.get('to') || '') - Date.parse(query?.get('from') || '');
  }).toBe(3_600_000);
  state.archiveFails = true;
  await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('alpha');
  await expect(page.getByText('Your filters still apply', { exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'alpha', exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'beta', exact: false })).toHaveCount(0);
  await page.clock.fastForward(300_001);
  await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toHaveValue('alpha');
  await expect(page.getByRole('cell', { name: 'beta', exact: false })).toHaveCount(0);
});

test('Today retains its source selection across background refresh', async ({ page }) => {
  await fixture(page);
  await page.goto('/#/today/summary');
  const codex = page.getByRole('button', { name: 'Codex', exact: true });
  await codex.click();
  await expect(codex).toHaveAttribute('aria-pressed', 'true');
  await page.clock.fastForward(300_001);
  await expect(codex).toHaveAttribute('aria-pressed', 'true');
});

test('weekly insights use pinned local evidence and keep feedback across Today and Learn', async ({ page }, testInfo) => {
  const state = await fixture(page);
  state.weeklyRows = [
    { ...rows[0], session_id: 'ghost-a', project: 'alpha', started_at: '2026-10-01T11:00:00Z', ended_at: '2026-10-01T11:00:00Z', is_ghost: true },
    { ...rows[0], session_id: 'ghost-b', project: 'alpha', started_at: '2026-10-02T11:00:00Z', ended_at: '2026-10-02T11:00:00Z', is_ghost: true },
    { ...rows[0], session_id: 'child-only', project: 'alpha', started_at: '2026-10-02T11:30:00Z', ended_at: '2026-10-02T11:30:00Z', is_ghost: true, is_subagent: true },
  ];
  state.learnRows = [{ ...rows[0], session_id: 'learn-test', session_title: 'test-related session', user_message_count: 8 }];
  await page.goto('/#/today/summary');
  const card = page.locator('.weekly-insight-card').filter({ hasText: 'Sessions without assistant output' });
  await expect(card).toContainText('2 independent sessions');
  await expect(card).toContainText('2 independent sessions were marked as producing no assistant output');
  await page.screenshot({ path: testInfo.outputPath('weekly-insights-desktop.png'), fullPage: true });
  await card.getByRole('button', { name: 'Useful' }).click();
  await expect(card.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('combobox', { name: 'Follow-up outcome for Sessions without assistant output' }).selectOption('tried-helped');
  await expect(page.getByText('Feedback saved on this device.', { exact: true })).toBeVisible();
  await expect.poll(() => state.archiveRequests.some((url) => {
    const duration = Date.parse(url.searchParams.get('to') || '') - Date.parse(url.searchParams.get('from') || '');
    return duration >= 11 * 86_400_000 && duration <= 14 * 86_400_000;
  })).toBe(true);
  await page.goto('/#/learn');
  const learnCard = page.locator('.weekly-insight-card').filter({ hasText: 'Sessions without assistant output' });
  await expect(learnCard.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'true');
  await expect(learnCard.getByRole('combobox', { name: 'Follow-up outcome for Sessions without assistant output' })).toHaveValue('tried-helped');
  await expect(page.getByText(/not what you understood or successfully shipped/)).toBeVisible();
});

test('Review distinguishes failed reads and does not invent simulation success', async ({ page }) => {
  const state = await fixture(page);
  state.queueFails = true;
  await page.goto('/#/review/inbox');
  await expect(page.getByRole('alert')).toContainText('queue is unavailable, not empty');
  await expect(page.getByText('No proposals yet', { exact: false })).toHaveCount(0);
  state.queueFails = false;
  await page.getByRole('button', { name: 'Retry review' }).click();
  await expect(page.getByText('simulation result unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('simulation passed', { exact: true })).toHaveCount(0);
});

test('Ledger keeps missing estimates unavailable and explicit observed zero separate', async ({ page }) => {
  await fixture(page);
  await page.route('**/data/snapshot.json*', (route) => route.fulfill({ json: {
    schemaVersion: 1,
    generation: { id: 'cost-fixture', createdAt: NOW.toISOString() },
    sessions: [{ ...rows[0], estimated_cost_usd: null, observed_cost_usd: 0, cost_kind: 'observed' }],
    summary: {
      allTime: { sessions: 1, cost: null, estimated_cost_usd: null, observed_cost_usd: 0,
        estimated_cost_sessions: 0, observed_cost_sessions: 1, unavailable_cost_sessions: 0 },
      byModel: [{ key: 'fixture-model', sessions: 1, tokens: 100, cost: null, observed_cost_usd: 0 }],
    },
    lastGood: false,
  } }));
  await page.goto('/#/ledger');
  const estimates = page.locator('.mo-card').filter({ has: page.getByText('Known estimates', { exact: true }) });
  const observed = page.locator('.mo-card').filter({ has: page.getByText('Observed charges', { exact: true }) });
  await expect(estimates).toContainText('Unavailable');
  await expect(observed).toContainText('$0.00');
  await expect(page.getByRole('note')).toContainText('do not add them together');
  await expect(page.getByRole('region', { name: 'Model cost breakdown' })).toContainText('Unavailable');
});
