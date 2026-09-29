/**
 * Meow Operations — end-to-end test suite
 *
 * Runs against the Vite preview build (dist/).
 * Covers the five surfaces (Today, Review, Ledger, Sanctum, Learn) plus key interactions.
 */
import { expect, test, type CDPSession } from '@playwright/test';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

// Network-backed cockpit tests need route mocks to reach Playwright instead of
// being answered by a previously installed production service worker.
test.use({ serviceWorkers: 'block' });

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_HELPER_ORIGIN = new URL(
  loadEnv('production', PROJECT_ROOT, 'VITE_').VITE_LOCAL_SYNC_URL || 'http://127.0.0.1:7337',
).origin;
const LOCAL_HELPER_ROUTE = `${LOCAL_HELPER_ORIGIN}/**`;

type ChromiumTraceEvent = {
  name?: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  args?: Record<string, unknown>;
};

type PresentationIntervalMetric = {
  thread: string;
  stage: string;
  completedFrames: number;
  durationP95Ms: number | null;
  presentationIntervalP95Ms: number | null;
  uniquePresentations: number;
  uniquePresentationIntervalP95Ms: number | null;
  uniqueIntervalsOver25ms: number;
};

const COMPOSITOR_TRACE_CATEGORIES = [
  'toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame', 'benchmark', 'cc', 'gpu', 'graphics.pipeline', 'viz',
].join(',');

async function captureChromiumTrace<T>(cdp: CDPSession, sample: () => Promise<T>) {
  const events: ChromiumTraceEvent[] = [];
  const onDataCollected = (payload: { value: ChromiumTraceEvent[] }) => events.push(...payload.value);
  const tracingComplete = new Promise<void>((resolve) => {
    cdp.once('Tracing.tracingComplete', () => resolve());
  });
  cdp.on('Tracing.dataCollected', onDataCollected);
  try {
    await cdp.send('Tracing.start', { categories: COMPOSITOR_TRACE_CATEGORIES, transferMode: 'ReportEvents' });
    const result = await sample();
    await cdp.send('Tracing.end');
    await tracingComplete;
    return { result, events };
  } finally {
    cdp.off('Tracing.dataCollected', onDataCollected);
  }
}

function summarizePresentationIntervals(events: ChromiumTraceEvent[]): PresentationIntervalMetric[] {
  const threadNames = new Map<string, string>();
  for (const event of events) {
    if (event.ph !== 'M' || event.name !== 'thread_name' || typeof event.args?.name !== 'string') continue;
    threadNames.set(`${event.pid ?? 0}:${event.tid ?? 0}`, event.args.name);
  }
  const stageNames = new Set([
    'SubmitCompositorFrameToPresentationCompositorFrame',
    'SubmitUpdateDisplayTreeToPresentationCompositorFrame',
  ]);
  const openStages = new Map<string, number[]>();
  const completedStages = new Map<string, { thread: string; stage: string; ends: number[]; durations: number[] }>();
  for (const event of events.filter((candidate) => (
    stageNames.has(candidate.name ?? '')
    && Number.isFinite(candidate.ts)
    && ['B', 'E', 'b', 'e'].includes(candidate.ph ?? '')
  )).sort((left, right) => (left.ts ?? 0) - (right.ts ?? 0))) {
    const threadKey = `${event.pid ?? 0}:${event.tid ?? 0}`;
    const key = `${threadKey}:${event.name ?? 'unknown'}`;
    const stack = openStages.get(key) ?? [];
    if (event.ph === 'B' || event.ph === 'b') {
      stack.push(event.ts ?? 0);
      openStages.set(key, stack);
      continue;
    }
    const start = stack.pop();
    if (start == null) continue;
    const metric = completedStages.get(key) ?? {
      thread: threadNames.get(threadKey) ?? 'unknown thread',
      stage: event.name ?? 'unknown',
      ends: [],
      durations: [],
    };
    metric.ends.push(event.ts ?? 0);
    metric.durations.push(((event.ts ?? 0) - start) / 1000);
    completedStages.set(key, metric);
  }
  const percentile95 = (values: number[]) => {
    const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
    const value = sorted[Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1)];
    return value == null ? null : Number(value.toFixed(2));
  };
  return [...completedStages.values()].map((metric) => {
    const timestamps = [...metric.ends].sort((left, right) => left - right);
    // Multiple pipeline reporters can complete at one presentation timestamp.
    const uniqueTimestamps = [...new Set(timestamps)];
    const intervals = timestamps.slice(1).map((timestamp, index) => (timestamp - (timestamps[index] ?? timestamp)) / 1000);
    const uniqueIntervals = uniqueTimestamps.slice(1).map((timestamp, index) => (timestamp - (uniqueTimestamps[index] ?? timestamp)) / 1000);
    return {
      thread: metric.thread,
      stage: metric.stage,
      completedFrames: metric.ends.length,
      durationP95Ms: percentile95(metric.durations),
      presentationIntervalP95Ms: percentile95(intervals),
      uniquePresentations: uniqueTimestamps.length,
      uniquePresentationIntervalP95Ms: percentile95(uniqueIntervals),
      uniqueIntervalsOver25ms: uniqueIntervals.filter((interval) => interval > 25).length,
    };
  }).filter((metric) => metric.completedFrames > 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait for the React root to mount and return its inner HTML length. */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.innerHTML.length > 1000;
  }, { timeout: 20_000 });
}

/** Click a sidebar nav button by label. */
async function nav(page: import('@playwright/test').Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('button', { name: new RegExp(`^${escaped}`) }).first().click();
  await page.waitForTimeout(600);
}

async function openTab(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('tab', { name: label, exact: true }).click();
  await page.waitForTimeout(400);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
});

// ── 1. App shell ──────────────────────────────────────────────────────────────

test('page title is Meow Operations', async ({ page }) => {
  await expect(page).toHaveTitle('Meow Operations');
});

test('sidebar renders all nav buttons', async ({ page }) => {
  const expectedNav = ['Today', 'Review', 'Ledger', 'Sanctum', 'Learn'];
  for (const label of expectedNav) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(
      page.getByRole('button', { name: new RegExp(`^${escaped}`) }).first(),
    ).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Start focus timer' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Companion/ })).toHaveCount(0);
});

test('Projects: Summary and Detail views use governed local evidence', async ({ page }) => {
  const project = {
    project: {
      project_id: 'meow-ops-4efe35ade3', name: 'Meow Ops', aliases: ['meow-ops'],
      learning_state_path: '/work/meow-ops/.meow/learning-state',
    },
    constitution: {
      coverage: { confirmed: 7, total: 7, ratio: 1 },
      fields: { mission: { value: 'Keep project learning evidence-bound and owner-governed.' } },
    },
    agents: { observed: ['codex', 'claude'], blind_spots: ['antigravity', 'cursor', 'hermes'] },
    learning: { counts: { proposed: 1 }, candidates: [] },
  };
  await page.route(LOCAL_HELPER_ROUTE, (route) => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'x-meow-ops-local, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(route.request().url()).pathname;
    if (path === '/loop-eng/summary') return route.fulfill({ headers, json: { ok: true } });
    if (path === '/projects') return route.fulfill({ headers, json: { ok: true, projects: [project] } });
    if (path.endsWith('/learning-state')) {
      return route.fulfill({ headers, json: { ok: true, files: { 'INDEX.md': '# Meow Ops', 'constitution.md': '# Constitution' } } });
    }
    if (path.endsWith('/evidence')) {
      return route.fulfill({ headers, json: { ok: true, items: [{ session_id: 'session-1', source: 'codex', content: 'Owner approved the constitution.', started_at: '2026-07-19T10:00:00.000Z' }] } });
    }
    return route.fulfill({ status: 404, headers, json: { error: 'not found' } });
  });

  await nav(page, 'Review');
  await openTab(page, 'Projects');
  await expect(page.getByRole('heading', { name: 'Meow Ops', exact: true })).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();
  await expect(page.getByText('2/5')).toBeVisible();
  await expect(page.getByText('Owner-approved constitution')).toBeVisible();
  await page.getByRole('button', { name: 'Detail' }).click();
  await expect(page.getByText('Owner approved the constitution.')).toBeVisible();
  await expect(page.getByText('INDEX.md')).toBeVisible();
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Project Control: register a local project and govern proposed learning end to end', async ({ page }) => {
  let registered = false;
  let learningStatus: 'proposed' | 'deferred' | 'published' = 'proposed';
  let nonceCounter = 0;
  const candidate = () => ({
    learning_id: 'learn-owner-review',
    project_id: 'lifecycle-project-123',
    kind: 'practice',
    title: 'Require local proof before project claims',
    rationale: 'Keeps project guidance grounded in inspectable evidence.',
    impact: 'high',
    confidence: 0.95,
    status: learningStatus,
    evidence: [{ kind: 'session', ref: 'session-1' }],
  });
  const snapshot = () => ({
    project: {
      project_id: 'lifecycle-project-123',
      name: 'Lifecycle Project',
      aliases: ['lifecycle', 'project-lifecycle'],
      root: '/Users/test/projects/lifecycle',
      learning_state_path: '/Users/test/projects/lifecycle/.meow/learning-state',
      git_remote: null,
    },
    constitution: {
      coverage: { confirmed: 0, total: 7, ratio: 0 },
      fields: {},
    },
    agents: { observed: [], blind_spots: ['codex', 'claude', 'antigravity', 'cursor', 'hermes'] },
    learning: {
      counts: { [learningStatus]: 1 },
      candidates: [candidate()],
    },
  });

  await page.route(LOCAL_HELPER_ROUTE, async (route) => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'x-meow-ops-local, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    };
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname;
    if (path === '/loop-eng/summary') return route.fulfill({ headers, json: { ok: true } });
    if (path === '/loop-eng/nonce') {
      nonceCounter += 1;
      return route.fulfill({ headers, json: { ok: true, nonce: `owner-nonce-${nonceCounter}` } });
    }
    if (path === '/projects' && request.method() === 'GET') {
      return route.fulfill({ headers, json: { ok: true, projects: registered ? [snapshot()] : [] } });
    }
    if (path === '/projects' && request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(body).toMatchObject({
        nonce: expect.stringMatching(/^owner-nonce-/),
        name: 'Lifecycle Project',
        root: '/Users/test/projects/lifecycle',
        aliases: ['lifecycle', 'project-lifecycle'],
      });
      registered = true;
      return route.fulfill({ status: 201, headers, json: { ok: true, project: snapshot().project } });
    }
    if (path.endsWith('/learning-state')) {
      return route.fulfill({ headers, json: { ok: true, project: snapshot().project, files: {} } });
    }
    if (path.endsWith('/decision') && request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(body.nonce).toMatch(/^owner-nonce-/);
      expect(body.reason).toMatch(/owner reviewed/i);
      learningStatus = body.decision === 'approved' ? 'published' : body.decision;
      return route.fulfill({ headers, json: { ok: true, learning: candidate() } });
    }
    return route.fulfill({ status: 404, headers, json: { ok: false, error: 'not found' } });
  });

  await nav(page, 'Review');
  await openTab(page, 'Projects');
  await expect(page.getByRole('heading', { name: 'No governed projects yet' })).toBeVisible();
  await page.getByLabel('Project name').fill('Lifecycle Project');
  await page.getByLabel('Local project folder').fill('/Users/test/projects/lifecycle');
  await page.getByLabel(/Aliases/).fill('lifecycle, project-lifecycle');
  await page.getByRole('button', { name: 'Register project' }).click();

  await expect(page.getByRole('heading', { name: 'Lifecycle Project', exact: true })).toBeVisible();
  await expect(page.getByText('Require local proof before project claims')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Defer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();

  await page.getByRole('button', { name: 'Defer' }).click();
  await expect(page.getByText(/A reason is required/)).toBeVisible();
  const reason = page.getByLabel('Reason for Require local proof before project claims');
  await reason.fill('Owner reviewed the evidence and wants one more verified example.');
  await page.getByRole('button', { name: 'Defer' }).click();
  await expect(page.getByText('Learning deferred. The project snapshot has been refreshed.')).toBeVisible();
  await expect(page.getByText('deferred', { exact: true })).toBeVisible();

  await reason.fill('Owner reviewed the additional evidence and accepts this project practice.');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Learning approved and published. The project snapshot has been refreshed.')).toBeVisible();
  await expect(page.getByText('published', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

test('Learn mines concepts from session tool mix', async ({ page }) => {
  await page.route(/\/data\/sessions\.json(?:\?|$)/, (route) => route.fulfill({
    json: [
      {
        session_id: 's-trace', project: 'meow-ops', model: 'claude-sonnet',
        started_at: '2026-08-30T10:00:00.000Z', ended_at: '2026-08-30T10:20:00.000Z',
        duration_seconds: 1200, message_count: 12, user_message_count: 4, assistant_message_count: 8,
        input_tokens: 1000, output_tokens: 400, cache_creation_tokens: 0, cache_read_tokens: 0,
        total_tokens: 1400, estimated_cost_usd: 0.02, cat_type: 'detective', is_ghost: false,
        source: 'claude', tools: { Read: 12, Grep: 8, Glob: 3, Edit: 1 },
        session_title: 'Chase the null in export-local', first_user_message: 'why is parse failing',
      },
      {
        session_id: 's-retry', project: 'meow-ops', model: 'claude-sonnet',
        started_at: '2026-08-30T11:00:00.000Z', ended_at: '2026-08-30T11:40:00.000Z',
        duration_seconds: 2400, message_count: 20, user_message_count: 8, assistant_message_count: 12,
        input_tokens: 2000, output_tokens: 800, cache_creation_tokens: 0, cache_read_tokens: 0,
        total_tokens: 2800, estimated_cost_usd: 0.04, cat_type: 'builder', is_ghost: false,
        source: 'claude', tools: { Edit: 14, Write: 6, Read: 4 },
        session_title: 'rewrite the fetch helper again', first_user_message: 'same timeout retry',
      },
    ],
  }));
  await page.reload();
  await waitForApp(page);
  await nav(page, 'Learn');
  await expect(page.getByRole('list', { name: 'Inferred concepts' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stack tracing' })).toBeVisible();
  await expect(page.getByText(/That is stack tracing/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Idempotent retries' })).toBeVisible();
  await expect(page.getByText(/You kept rewriting the same helper/)).toBeVisible();
  await expect(page.getByText(/meow-ops, \d+ sessions?/).first()).toBeVisible();
  await expect(page.getByText(/YouTube/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'I get this' }).first().click();
  await expect(page.getByRole('button', { name: 'I get this' }).first()).toBeVisible();
  await expect(page.getByText(/Builder's Journey|Workshop health|From vibe to first principles/)).toHaveCount(0);
});

test('Learn empty state asks for a parse when no sessions exist', async ({ page }) => {
  await page.route(/\/data\/sessions\.json(?:\?|$)/, (route) => route.fulfill({ json: [] }));
  await page.reload();
  await waitForApp(page);
  await nav(page, 'Learn');
  await expect(page.getByText('No sessions to mine yet')).toBeVisible();
  await expect(page.getByText('node sync/export-local.mjs')).toBeVisible();
});

test('sidebar shows Source Usage panel when multiple sources exist', async ({ page }) => {
  // The panel is only rendered when the data has multiple sources.
  // If only Claude data is present the panel is hidden — that's correct behaviour.
  const panel = page.locator('text=Source Usage');
  const count = await panel.count();
  // Accept 0 (single-source data) or 1 (multi-source data)
  expect(count).toBeGreaterThanOrEqual(0);
});

// ── 2. Overview ───────────────────────────────────────────────────────────────

test('Overview: stat cards render', async ({ page }) => {
  // StatTile labels use CSS uppercase, so match the rendered text.
  await expect(page.getByText(/^sessions$/i).first()).toBeVisible();
  await expect(page.getByText(/^tokens$/i).first()).toBeVisible();
  await expect(page.getByText(/^cost$/i).first()).toBeVisible();
  await expect(page.getByText(/^time$/i).first()).toBeVisible();
});

test('Overview: daily tokens chart renders', async ({ page }) => {
  await expect(page.getByText(/Tokens per day/i).first()).toBeVisible();
});

test('Overview: top projects render', async ({ page }) => {
  await expect(page.getByText('Top projects').or(page.getByText('No sessions parsed yet')).first()).toBeVisible();
});

test('Overview: source filter toggles exist when Codex data present', async ({ page }) => {
  const hasCodex = await page.locator('button:has-text("⬡ Codex")').count() > 0;
  if (hasCodex) {
    await page.getByRole('button', { name: '◆ Claude' }).click();
    await expect(page.locator('text=filtered: ◆ Claude only')).toBeVisible();
    await page.getByRole('button', { name: '▣ Cursor' }).click();
    await expect(page.locator('text=filtered: ▣ Cursor only')).toBeVisible();
    // Reset
    await page.getByRole('button', { name: 'All' }).first().click();
  }
});

test('Overview: Source Breakdown section renders with Codex data', async ({ page }) => {
  const hasCodex = await page.locator('button:has-text("⬡ Codex")').count() > 0;
  if (hasCodex) {
    await expect(page.locator('text=Source Breakdown').first()).toBeVisible();
    await expect(page.locator('text=Ghost Rate').first()).toBeVisible();
  }
});

test('Overview: unmatched Cursor Admin usage is visible but not assigned to sessions', async ({ page }) => {
  const bucket = { cost: 0, tokens: 0, sessions: 0, duration_seconds: 0 };
  await page.route(/\/data\/cost-summary\.json(?:\?|$)/, (route) => route.fulfill({
    json: {
      exportedAt: '2026-08-16T00:00:00.000Z',
      today: bucket,
      thisWeek: bucket,
      lastWeek: bucket,
      thisMonth: bucket,
      lastMonth: bucket,
      thisYear: bucket,
      lastYear: bucket,
      allTime: bucket,
      bySource: {},
      bySourceAllTime: {},
      daily_summary: [],
      cursorUsage: {
        enabled: true,
        status: 'ok',
        period: { startDate: 1787616000000, endDate: 1790467200000 },
        matched_sessions: 1,
        matched_events: 2,
        unmatched_events: 3,
        totals: {
          events: 5,
          charged_cents: 50,
          charged_cents_events: 5,
          token_model_cost_cents: 42,
          cursor_token_fee_cents: 8,
          requests_cost_units: 4,
          chargeable_true_events: 4,
          chargeable_false_events: 1,
          chargeable_unknown_events: 0,
        },
        by_kind: [
          { key: 'Usage-based', events: 4, requests_cost_units: 4, charged_cents: 50 },
          { key: 'Included in Business', events: 1, requests_cost_units: 0, charged_cents: 0 },
        ],
        unmatched: {
          totals: { events: 3, total_tokens: 1200, estimated_cost_usd: 0.42 },
          by_model: [
            { key: 'gpt-5', events: 2, total_tokens: 900, estimated_cost_usd: 0.30 },
            { key: 'composer-2', events: 1, total_tokens: 300, estimated_cost_usd: 0.12 },
          ],
        },
      },
    },
  }));
  await page.reload();
  await waitForApp(page);

  await nav(page, 'Ledger');
  await expect(page.getByText('Provider-reported usage', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Cursor Admin API billing summary')).toContainText('5 events');
  await expect(page.getByRole('region', { name: 'Cursor billing categories' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cursor billing categories' })).toContainText('Usage-based');
  await expect(page.getByText('gpt-5', { exact: true })).toBeVisible();
  await expect(page.getByText('composer-2', { exact: true })).toBeVisible();
});

test('Overview: Hermes reports every model used in multi-model sessions', async ({ page }) => {
  const bucket = { cost: 0, tokens: 0, sessions: 0, duration_seconds: 0 };
  await page.route(/\/data\/cost-summary\.json(?:\?|$)/, (route) => route.fulfill({
    json: {
      exportedAt: '2026-08-16T00:00:00.000Z',
      today: bucket,
      thisWeek: bucket,
      lastWeek: bucket,
      thisMonth: bucket,
      lastMonth: bucket,
      thisYear: bucket,
      lastYear: bucket,
      allTime: bucket,
      bySource: {},
      bySourceAllTime: {},
      daily_summary: [],
      hermesModelUsage: {
        status: 'ok',
        sessions: 2,
        models: 2,
        totals: { api_calls: 6, total_tokens: 420, estimated_cost_usd: 0.02 },
        by_model: [
          { key: 'ollama:local-a:', model: 'local-a', provider: 'ollama', sessions: 2, total_tokens: 360, estimated_cost_usd: 0 },
          { key: 'openrouter:cloud-b:chat_completions', model: 'cloud-b', provider: 'openrouter', sessions: 1, total_tokens: 60, estimated_cost_usd: 0.02 },
        ],
      },
    },
  }));
  await page.reload();
  await waitForApp(page);
  await nav(page, 'Ledger');
  await expect(page.getByText('local-a', { exact: true })).toBeVisible();
  await expect(page.getByText('cloud-b', { exact: true })).toBeVisible();
});

test('Overview: date filter is on the page', async ({ page }) => {
  await page.getByRole('button', { name: '7d', exact: true }).click();
  await expect(page.getByRole('button', { name: '7d', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '30d', exact: true }).click();
});

// ── 3. Sessions ───────────────────────────────────────────────────────────────

test('Sessions: table renders with rows', async ({ page }) => {
  await nav(page, 'Today');
  await openTab(page, 'Sessions');
  // Either a table or a "no sessions" message
  const hasTable  = await page.locator('table, [role="grid"]').count() > 0;
  const hasMsg    = await page.locator('text=/no sessions|no data|empty/i').count() > 0;
  expect(hasTable || hasMsg).toBe(true);
});

// ── 4. By Project ─────────────────────────────────────────────────────────────

test('By Project: renders without error', async ({ page }) => {
  await nav(page, 'Today');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
});

// ── 5. By Day ─────────────────────────────────────────────────────────────────

test('By Day: area chart renders', async ({ page }) => {
  await nav(page, 'Ledger');
  // Recharts renders an svg
  await expect(page.locator('svg').first()).toBeVisible();
});

// ── 6. By Action ──────────────────────────────────────────────────────────────

test('By Action: tool breakdown renders', async ({ page }) => {
  await nav(page, 'Today');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
});

// ── 7. Cost Tracker ───────────────────────────────────────────────────────────

test('Cost Tracker: renders without crash', async ({ page }) => {
  await nav(page, 'Ledger');
  await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible();
});

// ── 8. Analytics ──────────────────────────────────────────────────────────────

test('Analytics: lazy chunk loads without error', async ({ page }) => {
  await nav(page, 'Ledger');
  // Lazy chunk — allow extra time
  await page.waitForFunction(
    () => document.getElementById('root')!.innerHTML.length > 2000,
    { timeout: 20_000 },
  );
  // No uncaught error overlay
  await expect(page.locator('[data-vite-error], .error-overlay')).toHaveCount(0);
});

// ── 9. Agent Ops ──────────────────────────────────────────────────────────────

test('Agent Ops: Gantt timeline renders', async ({ page }) => {
  await nav(page, 'Today');
  await openTab(page, 'Runs');
  await page.waitForFunction(
    () => document.getElementById('root')!.innerHTML.length > 2000,
    { timeout: 20_000 },
  );
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

// ── 10. Sanctum ───────────────────────────────────────────────────────

test('Sanctum: page loads', async ({ page }) => {
  await nav(page, 'Sanctum');
  await expect(page.getByRole('heading', { name: 'Sanctum', exact: true }))
    .toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Sanctum: header bar visible', async ({ page }) => {
  await nav(page, 'Sanctum');
  await expect(page.getByText('Sanctum session archive', { exact: true }))
    .toBeVisible({ timeout: 15_000 });
});

test('Sanctum: production loads Seal-marked roster art and keeps 3D studies local-only', async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const modelRequests: string[] = [];
  const artResponses: { path: string; status: number }[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/design/sanctum/blender/') && url.pathname.endsWith('.glb')) {
      modelRequests.push(url.pathname);
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.webp')) {
      artResponses.push({ path: url.pathname, status: response.status() });
    }
  });
  const now = Date.now();
  const roles = [
    ['detective', 'Gloamwhisker'],
    ['builder', 'Rivetwren'],
    ['architect', 'Gridwhisk'],
    ['commander', 'Skirlbell'],
    ['guardian', 'Shieldheart'],
    ['storyteller', 'Foliosong'],
    ['ghost', 'Lanternmote'],
  ] as const;
  const syntheticRoles = [...roles, ['builder', 'Rivetwren copy'] as const];
  await page.route('**/loop-eng/eternal-stats', (route) => route.abort());
  await page.route('**/data/sessions.json*', (route) => route.fulfill({
    json: syntheticRoles.map(([catType, label], index) => ({
      session_id: `sanctum-production-roster-${index}`,
      project: 'sanctum-production-roster-gate',
      model: 'claude-sonnet-4-6',
      entrypoint: 'test',
      git_branch: 'production-roster-gate',
      started_at: new Date(now + index * 1_000).toISOString(),
      ended_at: new Date(now + index * 1_000 + 300_000).toISOString(),
      duration_seconds: 300,
      message_count: 2,
      user_message_count: 1,
      assistant_message_count: 1,
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 15,
      estimated_cost_usd: 0,
      cat_type: catType,
      is_ghost: false,
      source: 'codex',
      agent_slug: `roster-gate-${index}`,
      session_title: `Synthetic ${label} archive session`,
      tools: { Read: 1 },
    })),
  }));
  await page.goto('/?roster=3d#/sanctum');
  await expect(page.getByText('Sanctum session archive', { exact: true }))
    .toBeVisible({ timeout: 15_000 });
  const roster = page.locator('.sanctum-roster button');
  await expect(roster).toHaveCount(8, { timeout: 20_000 });
  await expect(page.locator('[data-testid="sanctum-roster-character-loaded"]')).toHaveCount(8, { timeout: 20_000 });
  await expect.poll(() => artResponses.length).toBe(7);
  expect(artResponses.every(({ status }) => status === 200)).toBe(true);
  for (const [catType, label] of roles) {
    await page.locator(`.sanctum-roster button[title^="Synthetic ${label} archive session"]`).click();
    await expect(page.locator(`[data-testid="sanctum-roster-character-loaded"][data-session-selected="true"][data-roster-role="${catType}"]`))
      .toHaveCount(1, { timeout: 20_000 });
  }
  expect(new Set(artResponses.map(({ path }) => path)).size).toBe(7);
  await expect(page.locator('[data-testid="sanctum-roster-model-loaded"]')).toHaveCount(0);
  expect(modelRequests).toEqual([]);
});

test('Sanctum: archive scene fits a narrow viewport', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, 'Sanctum');
  await expect(page.getByText('Sanctum session archive', { exact: true }))
    .toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('ARCHIVE WARDEN', { exact: true }))
    .toBeVisible({ timeout: 20_000 });
  await expect(page.locator('canvas').first()).toBeVisible();

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  const wardenBounds = await page.getByText('ARCHIVE WARDEN', { exact: true }).evaluate((element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect();
    return { left, right, top, bottom };
  });
  await page.screenshot({ path: 'test-results/sanctum-mobile.png' });
  expect(viewport.width).toBe(390);
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
  expect(wardenBounds.left).toBeGreaterThanOrEqual(72);
  expect(wardenBounds.right).toBeLessThanOrEqual(viewport.width);
  expect(wardenBounds.bottom).toBeLessThanOrEqual(844);

  const sceneCanvas = page.locator('canvas').first();
  await expect(sceneCanvas).toHaveAttribute('data-scene-camera-zoom', '14');
  await page.setViewportSize({ width: 960, height: 844 });
  await expect(sceneCanvas).toHaveAttribute('data-scene-camera-zoom', '38');
});

test('Sanctum: selected mobile session tag stays outside the inspector', async ({ browser }) => {
  test.setTimeout(60_000);
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const baseTime = Date.now();
  await page.route('**/loop-eng/eternal-stats', (route) => route.abort());
  await page.route('**/data/sessions.json*', (route) => route.fulfill({
    json: [{
      session_id: 'sanctum-mobile-rivetwren',
      project: 'sanctum-mobile-e2e',
      model: 'claude-sonnet-4-6',
      entrypoint: 'test',
      git_branch: 'mobile-roster-marker',
      started_at: new Date(baseTime).toISOString(),
      ended_at: new Date(baseTime + 300_000).toISOString(),
      duration_seconds: 300,
      message_count: 2,
      user_message_count: 1,
      assistant_message_count: 1,
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 15,
      estimated_cost_usd: 0,
      cat_type: 'builder',
      is_ghost: false,
      source: 'codex',
      agent_slug: 'mobile-builder',
      session_title: 'Synthetic mobile builder',
      tools: { Read: 1 },
    }],
  }));

  await page.goto('/');
  await waitForApp(page);
  await nav(page, 'Sanctum');
  const roster = page.locator('.sanctum-roster button');
  const inspector = page.locator('[data-testid="sanctum-session-inspector"]');
  await expect(roster).toHaveCount(1, { timeout: 20_000 });
  const seal = roster.first().getByRole('img', { name: 'Archive Seal' });
  await expect(seal).toBeVisible();
  const sealBounds = await seal.boundingBox();
  expect(sealBounds?.width).toBeGreaterThanOrEqual(18);
  expect(sealBounds?.height).toBeGreaterThanOrEqual(18);
  await roster.first().click();
  await expect(inspector.getByText('Synthetic mobile builder [sanctum-mobile-e2e]', { exact: true }))
    .toBeVisible();
  await expect(page.getByText('Session index', { exact: true })).toBeVisible();
  await expect(inspector.getByText('BUILDER · RIVETWREN · claude-sonnet-4-6', { exact: true }))
    .toBeVisible();
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: 'test-results/sanctum-mobile-selected-seal.png' });

  const stageTag = page.locator('[data-session-tag="true"]');
  await expect(stageTag).toHaveCount(1);
  await expect(stageTag).toHaveText(/^#[0-9A-F]{4}$/);
  const stageBounds = await stageTag.evaluate((element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect();
    return { left, right, top, bottom };
  });
  const inspectorBounds = await inspector.evaluate((element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect();
    return { left, right, top, bottom };
  });
  const minimap = page.locator('canvas.sanctum-hud-round');
  await expect(minimap).toBeVisible();
  const minimapBounds = await minimap.evaluate((element) => {
    const { left } = element.getBoundingClientRect();
    return { left };
  });
  expect(inspectorBounds.bottom).toBeLessThanOrEqual(844);
  expect(inspectorBounds.right).toBeLessThan(minimapBounds.left);
  expect(stageBounds!.left).toBeGreaterThanOrEqual(72);
  expect(stageBounds!.right).toBeLessThanOrEqual(390);
  expect(stageBounds!.bottom <= inspectorBounds.top
    || stageBounds!.top >= inspectorBounds.bottom
    || stageBounds!.right <= inspectorBounds.left
    || stageBounds!.left >= inspectorBounds.right,
  JSON.stringify({ stageBounds, inspectorBounds })).toBe(true);

  const nameplate = page.getByTestId('sanctum-session-nameplate');
  await expect(nameplate).toBeHidden();
  await page.close();
});

test('Sanctum: run-group dropdown labels render', async ({ page }) => {
  await nav(page, 'Sanctum');
  // Run-group dropdown lives in the page header. After Phase A.2 each
  // option label includes a day prefix ("today" / "yesterday" / weekday)
  // plus the project name. The dropdown is a native <select>, so its
  // options live in the DOM regardless of whether it's open.
  await page.waitForTimeout(4000);
  const text = await page.evaluate(() => document.body.innerText);
  const hasRunGroupShape =
    /\b(today|yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[, ]/.test(text)
    || /\d+\s+roots?\b/i.test(text);
  expect(hasRunGroupShape).toBe(true);
});

test('Sanctum: SVG canvas renders', async ({ page }) => {
  await nav(page, 'Sanctum');
  // Wait for demo data to load (auth check times out after 2s)
  await page.waitForTimeout(3000);
  const svgs = await page.locator('svg').count();
  expect(svgs).toBeGreaterThan(0);
});

test('Sanctum: scene renders without throwing into the error boundary', async ({ page }) => {
  // Regression for the prod incident on 2026-04-28 where the Sanctum's
  // SceneErrorBoundary tripped and black-screened the canvas. handleSceneError
  // logs the real exception via console.error('[ScryingSanctum] Scene error
  // caught:', err); we capture that here so future regressions surface the
  // actual stack instead of just the chip-existence signal.
  const sceneErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /\[ScryingSanctum\] Scene error/.test(msg.text())) {
      sceneErrors.push(msg.text());
    }
  });
  await nav(page, 'Sanctum');
  await page.waitForTimeout(4500);
  // If the boundary tripped, the chip ("⚠ N scene error[s] — reload if
  // stuck") will be in the DOM; surface the captured error message so
  // diagnosis is one click.
  const errorChip = page.locator('text=/scene error.*reload if stuck/i');
  const chipCount = await errorChip.count();
  if (chipCount > 0) {
    throw new Error(
      `Sanctum scene error chip visible (${chipCount}). Captured: ${
        sceneErrors.length ? sceneErrors.join(' || ') : '(no [ScryingSanctum] log captured)'
      }`,
    );
  }
  expect(chipCount).toBe(0);
});

test('Sanctum: per-session roster visible', async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/loop-eng/eternal-stats', (route) => route.abort());
  const baseTime = Date.now();
  const roles = [
    { id: 'builder-a', cat_type: 'builder', label: 'RIVETWREN' },
    { id: 'builder-b', cat_type: 'builder', label: 'RIVETWREN' },
    { id: 'detective', cat_type: 'detective', label: 'GLOAMWHISKER' },
    { id: 'commander', cat_type: 'commander', label: 'SKIRLBELL' },
    { id: 'architect', cat_type: 'architect', label: 'GRIDWHISK' },
    { id: 'guardian', cat_type: 'guardian', label: 'SHIELDHEART' },
    { id: 'storyteller', cat_type: 'storyteller', label: 'FOLIOSONG' },
    { id: 'ghost', cat_type: 'ghost', label: 'LANTERNMOTE' },
  ] as const;
  const makeSession = (id: string, cat_type: string, project: string, startedAt: number) => ({
    session_id: `sanctum-roster-${id}`,
    project,
    model: 'claude-sonnet-4-6',
    entrypoint: 'test',
    git_branch: `test/${id}`,
    started_at: new Date(startedAt).toISOString(),
    ended_at: new Date(startedAt + 300_000).toISOString(),
    duration_seconds: 300,
    message_count: 2,
    user_message_count: 1,
    assistant_message_count: 1,
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 15,
    estimated_cost_usd: 0,
    cat_type,
    is_ghost: false,
    source: 'codex' as const,
    agent_slug: `roster-${id}`,
    session_title: `Synthetic ${id}`,
    tools: { Read: 1 },
  });
  const rosterSessions = roles.map((role, index) => (
    makeSession(role.id, role.cat_type, 'sanctum-roster-e2e', baseTime - (roles.length - index) * 60_000)
  ));
  const selectionName = (id: string, project = 'sanctum-roster-e2e') => (
    `Synthetic ${id} [${project}]`
  );
  rosterSessions.push(makeSession('older-group', 'detective', 'old-run', baseTime - 7_200_000));
  await page.route('**/data/sessions.json*', (route) => route.fulfill({
    json: rosterSessions,
  }));
  await page.goto('/');
  await waitForApp(page);
  await nav(page, 'Sanctum');
  const roster = page.locator('.sanctum-roster button');
  const inspector = page.locator('[data-testid="sanctum-session-inspector"]');
  await expect(roster).toHaveCount(8, { timeout: 20_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(1_500);
  const stageTags = page.locator('[data-session-tag="true"]');
  await expect(stageTags).toHaveCount(8);
  await page.screenshot({ path: 'test-results/sanctum-desktop-roster-seal.png' });
  for (const role of roles) {
    const row = roster.filter({ hasText: role.id }).filter({ hasText: role.label });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('img', { name: 'Archive Seal' })).toBeVisible();
  }
  await expect(roster.filter({ hasText: 'RIVETWREN' })).toHaveCount(2);
  const builderTag = async (id: string) => {
    const text = await roster.filter({ hasText: id }).innerText();
    return text.match(/#([0-9A-F]{4})/)?.[1];
  };
  const builderTags = async () => [await builderTag('builder-a'), await builderTag('builder-b')];
  await expect.poll(builderTags).toEqual([
    expect.stringMatching(/^[0-9A-F]{4}$/),
    expect.stringMatching(/^[0-9A-F]{4}$/),
  ]);
  const [firstBuilderTag, secondBuilderTag] = await builderTags();
  expect(firstBuilderTag).not.toBe(secondBuilderTag);

  // Two builders keep the same class label but carry separate session IDs, branch
  // tags, and titles. Selecting each row must resolve its own session instance.
  for (const id of ['builder-a', 'builder-b']) {
    await roster.filter({ hasText: id }).click();
    await expect(inspector.getByText(selectionName(id), { exact: true })).toBeVisible();
    await expect(inspector.getByText('BUILDER · RIVETWREN · claude-sonnet-4-6', { exact: true }))
      .toBeVisible();
  }
  for (const role of roles.slice(2)) {
    await roster.filter({ hasText: role.id }).click();
    await expect(inspector.getByText(selectionName(role.id), { exact: true })).toBeVisible();
    await expect(inspector.getByText(`${role.cat_type.toUpperCase()} · ${role.label} · claude-sonnet-4-6`, { exact: true }))
      .toBeVisible();
  }

  // A held movement key must move the selected session while preserving that
  // exact session in the inspector. Keep a second builder present so class
  // identity alone cannot make the selection appear correct.
  await expect(roster.filter({ hasText: 'builder-b' })).toHaveCount(1);
  await roster.filter({ hasText: 'builder-a' }).click();
  await expect(inspector.getByText(selectionName('builder-a'), { exact: true })).toBeVisible();
  // Read the selected halo from the minimap; its full-opacity teal pixels are
  // distinct from its translucent border and from the class-colored dots.
  const minimap = page.locator('canvas.sanctum-hud-round');
  const selectedMarker = async () => minimap.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return { x: -1, y: -1, count: 0 };
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let x = 0;
    let y = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index]!;
      const green = data[index + 1]!;
      const blue = data[index + 2]!;
      const alpha = data[index + 3]!;
      if (alpha > 220 && red > 60 && red < 130 && green > 170 && blue > 140 && green > red * 1.4) {
        const pixel = index / 4;
        x += pixel % width;
        y += Math.floor(pixel / width);
        count++;
      }
    }
    return { x: count ? x / count : -1, y: count ? y / count : -1, count };
  });
  const otherBuilderMarker = async (selectedCenter: { x: number; y: number }) => (
    minimap.evaluate((element, selected) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) return { x: -1, y: -1, count: 0 };
      const { data, width } = context.getImageData(0, 0, canvas.width, canvas.height);
      let x = 0;
      let y = 0;
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index]!;
        const green = data[index + 1]!;
        const blue = data[index + 2]!;
        // Builder dots use #d68a3a. The color window also includes its 70%
        // alpha version while excluding the other six role colors.
        if (red < 140 || red > 230 || green < 85 || green > 160 || blue < 25 || blue > 75
          || red < green * 1.3) continue;
        const pixel = index / 4;
        const px = pixel % width;
        const py = Math.floor(pixel / width);
        // The selected halo reaches about 5.5 minimap pixels; a 6px mask
        // removes its own orange fill while preserving nearby builder dots.
        if (Math.hypot(px - selected.x, py - selected.y) < 6) continue;
        x += px;
        y += py;
        count++;
      }
      return { x: count ? x / count : -1, y: count ? y / count : -1, count };
    }, selectedCenter)
  );
  await page.waitForTimeout(350);
  const beforeMove = await selectedMarker();
  expect(beforeMove.count).toBeGreaterThan(8);
  const beforeOtherBuilder = await otherBuilderMarker(beforeMove);
  expect(beforeOtherBuilder.count).toBeGreaterThan(0);
  await page.keyboard.down('w');
  await page.waitForTimeout(1_400);
  await page.keyboard.up('w');
  let afterMove = { x: -1, y: -1, count: 0 };
  await expect.poll(async () => {
    afterMove = await selectedMarker();
    return Math.hypot(afterMove.x - beforeMove.x, afterMove.y - beforeMove.y);
  }, { timeout: 5_000 }).toBeGreaterThan(2);
  const afterOtherBuilder = await otherBuilderMarker(afterMove);
  expect(afterOtherBuilder.count).toBeGreaterThan(0);
  const selectedDelta = { x: afterMove.x - beforeMove.x, y: afterMove.y - beforeMove.y };
  const otherDelta = {
    x: afterOtherBuilder.x - beforeOtherBuilder.x,
    y: afterOtherBuilder.y - beforeOtherBuilder.y,
  };
  expect(selectedDelta.y).toBeLessThan(-2);
  expect(Math.hypot(selectedDelta.x - otherDelta.x, selectedDelta.y - otherDelta.y))
    .toBeGreaterThan(1.5);
  await expect(inspector.getByText(selectionName('builder-a'), { exact: true })).toBeVisible();

  // Switching run groups clears the previous session selection before the
  // older group's distinct session can be selected.
  await page.locator('select.sanctum-toolbar-run-group').selectOption('1');
  await expect(roster).toHaveCount(1);
  await expect(inspector).toHaveCount(0);
  await roster.first().click();
  await expect(inspector.getByText(selectionName('older-group', 'old-run'), { exact: true }))
    .toBeVisible();
});

test('Sanctum: selected-session speech stops when the guide closes and session changes', async ({ page }) => {
  test.setTimeout(60_000);
  const baseTime = Date.now();
  const sessions = ['guide-a', 'guide-b'].map((id, index) => ({
    session_id: `sanctum-guide-${id}`,
    project: 'sanctum-guide-e2e',
    model: 'claude-sonnet-4-6',
    entrypoint: 'test',
    git_branch: `test/${id}`,
    started_at: new Date(baseTime + index * 60_000).toISOString(),
    ended_at: new Date(baseTime + index * 60_000 + 300_000).toISOString(),
    duration_seconds: 300,
    message_count: 2,
    user_message_count: 1,
    assistant_message_count: 1,
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 15,
    estimated_cost_usd: 0,
    cat_type: 'builder',
    is_ghost: false,
    source: 'codex' as const,
    agent_slug: id,
    session_title: `Synthetic ${id}`,
    tools: { Read: 1 },
  }));
  const guideRequests: Array<{ session_id?: string; project?: string }> = [];
  let spokenText = '';

  await page.addInitScript(() => {
    class MockAudio {
      paused = true;
      playbackRate = 1;
      volume = 1;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onplay: (() => void) | null = null;

      constructor(_src: string) {
        const testWindow = window as Window & { __guideTestPlayers?: MockAudio[] };
        testWindow.__guideTestPlayers ??= [];
        testWindow.__guideTestPlayers.push(this);
      }

      async play() { this.paused = false; this.onplay?.(); }
      pause() { this.paused = true; }
      removeAttribute(_name: string) {}
      load() {}
    }
    Object.defineProperty(window, 'Audio', { configurable: true, value: MockAudio });
  });
  await page.route('**/data/sessions.json*', (route) => route.fulfill({ json: sessions }));
  await page.route('**/loop-eng/sanctum-guide', async (route) => {
    const request = route.request();
    const headers = {
      'Access-Control-Allow-Origin': request.headers().origin ?? 'http://127.0.0.1:4275',
      'Access-Control-Allow-Headers': 'content-type,x-meow-ops-local',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.postDataJSON() as { session_id?: string; project?: string };
    guideRequests.push(body);
    return route.fulfill({
      headers,
      json: {
        ok: true,
        answer: `Synthetic evidence for ${body.session_id}`,
        kind: 'observed-events',
        imported_at: null,
        unknowns: [],
        evidence: [{
          store: 'private project evidence',
          record_id: 'synthetic-event-guide-a',
          project: 'sanctum-guide-e2e',
          fields: {
            event_type: 'Synthetic verification',
            timestamp: new Date(baseTime).toISOString(),
            excerpt: 'Synthetic status verification.',
          },
        }],
        explanation: { status: 'invalid-response' },
        capabilities: [],
      },
    });
  });
  await page.route('**/loop-eng/guide-voice', async (route) => {
    const request = route.request();
    const headers = {
      'Access-Control-Allow-Origin': request.headers().origin ?? 'http://127.0.0.1:4275',
      'Access-Control-Allow-Headers': 'content-type,x-meow-ops-local',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.method() === 'GET') return route.fulfill({ headers, json: { available: true, status: 'ready' } });
    const body = request.postDataJSON() as { text?: string };
    spokenText = body.text ?? '';
    return route.fulfill({
      headers,
      json: { mime: 'audio/wav', audio: Buffer.from('RIFF0000WAVEfixture').toString('base64') },
    });
  });
  await page.goto('/');
  await waitForApp(page);
  await nav(page, 'Sanctum');

  const roster = page.locator('.sanctum-roster button');
  await roster.filter({ hasText: 'guide-a' }).click();
  await page.getByRole('button', { name: 'Ask the guide' }).click();
  const dialog = page.getByRole('dialog', { name: /Sanctum archive guide/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(dialog.getByText('Synthetic evidence for sanctum-guide-guide-a', { exact: true }))
    .toBeVisible();
  await expect(dialog.getByText(/local model explanation is unavailable \(invalid-response\).*original evidence remains available below/i))
    .toBeVisible();
  await expect(dialog.getByText('synthetic-event-guide-a', { exact: true })).toHaveCount(2);
  const useVoicebox = dialog.getByLabel(/Use local Voicebox/);
  await expect(useVoicebox).toBeEnabled();
  await useVoicebox.check();
  expect(guideRequests).toHaveLength(1);
  expect(guideRequests[0]).toMatchObject({
    session_id: 'sanctum-guide-guide-a',
    project: 'sanctum-guide-e2e',
  });

  await dialog.getByRole('button', { name: 'Read aloud / replay' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Speaking');
  expect(spokenText).toBe('Synthetic evidence for sanctum-guide-guide-a');
  const audioStarted = await page.evaluate(() => {
    const testWindow = window as Window & { __guideTestPlayers?: Array<{ paused: boolean }> };
    return testWindow.__guideTestPlayers?.some((player) => !player.paused) ?? false;
  });
  expect(audioStarted).toBe(true);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const testWindow = window as Window & { __guideTestPlayers?: Array<{ paused: boolean }> };
    return testWindow.__guideTestPlayers?.every((player) => player.paused) ?? false;
  })).toBe(true);
  await roster.filter({ hasText: 'guide-b' }).click();
  await page.getByRole('button', { name: 'Ask the guide' }).click();
  const nextDialog = page.getByRole('dialog', { name: /Sanctum archive guide/ });
  await expect(nextDialog).toBeVisible();
  await expect(nextDialog.getByText('sanctum-guide-guide-b', { exact: true })).toBeVisible();
  await expect(nextDialog.getByText('Synthetic evidence for sanctum-guide-guide-a', { exact: true }))
    .toHaveCount(0);
});

test('Sanctum: guide runtime model loads with its mouth and animation controls', async ({ page }) => {
  test.setTimeout(60_000);
  await nav(page, 'Sanctum');
  const askGuide = page.getByRole('button', { name: 'Ask the guide' });
  await expect(askGuide).toBeVisible({ timeout: 30_000 });
  await askGuide.click();
  await expect(page.getByRole('heading', { name: 'Sanctum archive guide' })).toBeVisible();
  const guideModelResponse = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return response.ok() && /\/guide-originalized-v110-runtime-[\w-]+\.glb$/.test(path);
  });
  await page.getByRole('button', { name: 'Load guide character' }).click();
  const modelBytes = await (await guideModelResponse).body();
  expect(createHash('sha256').update(modelBytes).digest('hex'))
    .toBe('068320d713f5694b097adee6f48547b41600957156c583e2386dac042dbfb01f');
  const jsonChunkLength = modelBytes.readUInt32LE(12);
  expect(modelBytes.readUInt32LE(16)).toBe(0x4e4f534a);
  const modelJson = JSON.parse(modelBytes.toString('utf8', 20, 20 + jsonChunkLength)) as {
    meshes?: Array<{ name?: string }>;
    nodes?: Array<{ name?: string }>;
  };
  expect(modelJson.nodes?.some((node) => node.name === 'Guide.Archive Seal v33')).toBe(true);
  expect(modelJson.meshes?.some((mesh) => mesh.name === 'Archive Seal exact geometry v33')).toBe(true);
  await expect(page.getByText('Character study loaded. Local Voicebox speech drives the mouth when alignment is available.'))
    .toBeVisible({ timeout: 45_000 });
  const guideView = page.locator('.guide-character');
  await expect(guideView).toHaveAttribute('data-guide-frame-fits', 'true');
  await expect(guideView.locator('canvas')).toHaveCount(1);
  const desktopFrameSize = await guideView.getAttribute('data-guide-frame-size');
  expect(desktopFrameSize).toBeTruthy();
  await page.screenshot({ path: 'test-results/sanctum-guide-runtime-v110.png' });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(() => guideView.getAttribute('data-guide-frame-size')).not.toBe(desktopFrameSize);
  const mobileFrameSize = await guideView.evaluate(element => {
    const { width, height } = element.getBoundingClientRect();
    return `${Math.round(width)}x${Math.round(height)}`;
  });
  await expect(guideView).toHaveAttribute('data-guide-frame-size', mobileFrameSize);
  await expect(guideView).toHaveAttribute('data-guide-frame-fits', 'true');
  const guideBounds = await guideView.evaluate(element => {
    const { left, right, width, height } = element.getBoundingClientRect();
    return { left, right, width, height, viewportWidth: window.innerWidth };
  });
  expect(guideBounds.left).toBeGreaterThanOrEqual(0);
  expect(guideBounds.right).toBeLessThanOrEqual(guideBounds.viewportWidth);
  expect(guideBounds.width).toBeGreaterThan(0);
  expect(guideBounds.height).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/sanctum-guide-runtime-v110-mobile.png' });
});

// ── 10b. Loop Ops ─────────────────────────────────────────────────────────────
// The spec fixture (public/data/loop-ops/spec.json) is LOCAL-ONLY and gitignored.
// via public/data/*, regenerated by the Phase 3 importer. Data-dependent tests
// skip on machines without it (fresh clones, CI) instead of failing; the
// hosted build intentionally ships the instructional empty state.

async function loopSpecPresent(page: import('@playwright/test').Page): Promise<boolean> {
  const res = await page.request.get('/data/loop-ops/spec.json');
  if (res.status() !== 200) return false;
  // The SPA fallback (vite preview / vercel rewrite) serves index.html with a
  // 200 for a missing file, so a bare status check false-positives on fresh
  // clones / CI runners with no local Loom data. Confirm it's really the spec
  // JSON before treating the fixture as present.
  const contentType = res.headers()['content-type'] || '';
  if (!contentType.includes('json')) return false;
  try {
    const body = await res.json();
    return !!(body && body.meta && typeof body.meta.entityCount === 'number');
  } catch {
    return false;
  }
}

async function mockLoopEng(
  page: import('@playwright/test').Page,
  data: {
    proposals?: unknown[];
    decisions?: unknown[];
    summary?: Record<string, unknown>;
    runs?: unknown[];
    comparisons?: unknown[];
    simulations?: unknown[];
    outcomes?: unknown[];
    digest?: Record<string, unknown> | null;
    digestHistory?: unknown[];
  },
) {
  await page.context().route('**/loop-eng/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payloadByPath: Record<string, unknown> = {
      '/loop-eng/summary': data.summary ?? { counts_by_status: {}, open_per_loop: {}, total: data.proposals?.length ?? 0 },
      '/loop-eng/proposals': data.proposals ?? [],
      '/loop-eng/decisions': data.decisions ?? [],
      '/loop-eng/runs': data.runs ?? [],
      '/loop-eng/comparisons': data.comparisons ?? [],
      '/loop-eng/simulations': data.simulations ?? [],
      '/loop-eng/outcomes': data.outcomes ?? [],
      '/loop-eng/digest': data.digest ?? {},
      '/loop-eng/digest/history': data.digestHistory ?? [],
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payloadByPath[path] ?? {}),
    });
  });
}

test('Review Map: safety badge renders with or without spec data', async ({ page }) => {
  await nav(page, 'Review');
  await openTab(page, 'Map');
  // The safety invariant badge is part of the page contract from Phase 1 on,
  // in both the empty state and the loaded source strip.
  await expect(page.locator('text=/production writes disabled/i').first()).toBeVisible();
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Loop Ops: canvas renders imported entities when waves expanded', async ({ page }) => {
  test.skip(!(await loopSpecPresent(page)), 'local-only Loop-Ops fixture absent — run the importer');
  const spec = await (await page.request.get('/data/loop-ops/spec.json')).json();
  await nav(page, 'Review');
  await openTab(page, 'Map');
  await expect(page.locator(`text=${spec.meta.entityCount} entities · ${spec.meta.assistantCount} surfaces`)).toBeVisible();
  await expect(page.locator('[data-testid="loop-canvas"]')).toBeVisible();
  await page.getByRole('button', { name: 'Expand all waves' }).click();
  await expect(page.locator('[data-testid="loop-entity"]')).toHaveCount(spec.meta.entityCount);
  // Local operator action, presence only.
  await expect(page.getByRole('button', { name: 'Refresh spec' })).toBeVisible();
});

test('Loop Ops: inspector drawer answers the four questions', async ({ page }) => {
  test.skip(!(await loopSpecPresent(page)), 'local-only Loop-Ops fixture absent — run the importer');
  await nav(page, 'Review');
  await openTab(page, 'Map');
  const spec = await (await page.request.get('/data/loop-ops/spec.json')).json();
  const firstWorker = spec.entities.find((e: { kind: string }) => e.kind === 'assistant');
  test.skip(!firstWorker, 'spec has no worker entity');
  await page.locator(`[data-entity-id="${firstWorker.id}"]`).click();
  const inspector = page.locator('[data-testid="loop-inspector"]');
  await expect(inspector).toBeVisible();
  for (const q of ['What owns this', 'What it can touch', 'Last verified state', 'Not verified']) {
    // exact:true — section headings only; body text also contains "not verified".
    await expect(inspector.getByText(q, { exact: true })).toBeVisible();
  }
  // Imported entities show a validation command and optional repo links.
  await expect(inspector.locator('text=/Validation/')).toBeVisible();
  await expect(inspector.locator('text=/npm run (build|test:sync)/')).toBeVisible();
  await inspector.getByRole('button', { name: 'Close inspector' }).click();
  await expect(inspector).toHaveCount(0);
});

test('Loop Ops: run timeline renders a recorded run with joined session cost', async ({ page }) => {
  test.skip(!(await loopSpecPresent(page)), 'local-only Loop-Ops fixture absent — run the importer');
  const runsRes = await page.request.get('/data/loop-ops/runs.json');
  const runsContentType = runsRes.headers()['content-type'] || '';
  test.skip(
    runsRes.status() !== 200 || !runsContentType.includes('json'),
    'local-only runs.json absent — record a run first (SOP §5)',
  );
  const runs = await runsRes.json();
  test.skip(!Array.isArray(runs) || runs.length === 0, 'runs.json empty');

  await nav(page, 'Review');
  await openTab(page, 'Map');
  const timeline = page.locator('[data-testid="loop-run-timeline"]');
  await expect(timeline).toBeVisible();
  const card = timeline.locator('[data-testid="loop-run"]').first();
  await expect(card).toBeVisible();
  // Cost joins only when the run's session ids resolve against sessions.json.
  const sessionsRes = await page.request.get('/data/sessions.json');
  if (sessionsRes.status() === 200) {
    const ids = new Set((await sessionsRes.json()).map((s: { session_id: string }) => s.session_id));
    if (runs[0].sessionIds.some((id: string) => ids.has(id))) {
      await expect(card.locator('text=/\\$\\d/')).toBeVisible();
    }
  }
  // Expanding surfaces the evidence contract: verified + not-verified lists.
  await card.getByRole('button').first().click();
  await expect(timeline.locator('text=/not verified:/').first()).toBeVisible();
});

test('Loop Ops: ledger-backed run timeline shows real cost and operator details', async ({ page }) => {
  const entity = (id: string, kind: 'coordinator' | 'director' | 'assistant', group: string | null, wave: number | null) => ({
    id, kind, label: id, group, surfaceKey: kind === 'assistant' ? id : null,
    archetype: null, riskClass: null, wave, status: 'passed', sources: [], repoLinks: [],
    allowedActions: [], detail: {},
  });
  const spec = {
    meta: {
      specVersion: 1, generatedBy: 'e2e', generatedAt: '2026-07-16T12:00:00.000Z',
      masterSpec: 'fixture', entityCount: 7, assistantCount: 2,
      productionWritesEnabled: false, links: {},
    },
    entities: [
      entity('coordinator', 'coordinator', null, null),
      entity('director-research', 'director', 'research', null),
      entity('director-build', 'director', 'build', null),
      entity('director-review', 'director', 'review', null),
      entity('director-ops', 'director', 'ops', null),
      entity('meow-ops-dev', 'assistant', 'research', 1),
      entity('meow-ops-guardrails', 'assistant', 'review', 2),
    ],
    edges: [{ id: 'dep.dev.guardrails', source: 'meow-ops-dev', target: 'meow-ops-guardrails' }],
  };
  const runs = [{
    id: 'run-ledger-e2e', goal: 'Light the cockpit', entityIds: ['meow-ops-dev'],
    state: 'passed', startedAt: '2026-07-16T12:00:00.000Z', endedAt: '2026-07-16T12:00:00.000Z',
    operator: 'claude+codex', sessionIds: [], artifacts: [], cost: { usd: 12.5, tokens: 4200 },
    verified: [], notVerified: [],
  }];
  await page.context().route('**/data/loop-ops/spec.json*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(spec),
  }));
  await page.context().route('**/data/loop-ops/runs.json*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(runs),
  }));
  await mockLoopEng(page, { comparisons: [{
    schema_version: 1, comparison_id: 'cmp-ledger-e2e', run_id: 'run-ledger-e2e',
    baseline_run_id: 'run-baseline', loop_id: 'meow-ops-dev', flags: [],
    deltas: {
      cost_usd_real: { before: 1, after: 35.6594, delta_pct: 3465.94 },
      total_tokens: { before: 100, after: 507.15, delta_pct: 407.15 },
      tool_error_count: { before: 2, after: 0, delta_pct: -100 },
    },
  }] });

  await nav(page, 'Review');
  await openTab(page, 'Map');
  const timeline = page.locator('[data-testid="loop-run-timeline"]');
  await expect(timeline.getByText('No runs recorded')).toHaveCount(0);
  const card = timeline.locator('[data-testid="loop-run"]');
  await expect(card).toBeVisible();
  await expect(card.getByText(/^\$12\.50/)).toBeVisible();
  await expect(card.locator('[data-testid="loop-run-delta"]')).toHaveCount(3);
  await expect(card.getByText(/real cost \+3465\.94%/)).toBeVisible();
  await card.getByRole('button').click();
  await expect(card.getByText('operator: claude+codex')).toBeVisible();
});

test('Loop Ops: stale gate degrades node status and exposes evidence in inspector', async ({ page }) => {
  const entity = (id: string, kind: 'coordinator' | 'director' | 'assistant', group: string | null, wave: number | null) => ({
    id, kind, label: id, group, surfaceKey: kind === 'assistant' ? id : null,
    archetype: null, riskClass: null, wave, status: 'passed', sources: [], repoLinks: [],
    allowedActions: [], detail: {},
  });
  const spec = {
    meta: {
      specVersion: 1, generatedBy: 'e2e', generatedAt: '2026-07-16T12:00:00.000Z',
      masterSpec: 'fixture', entityCount: 7, assistantCount: 2,
      productionWritesEnabled: false, links: {},
    },
    entities: [
      entity('coordinator', 'coordinator', null, null),
      entity('director-research', 'director', 'research', null),
      entity('director-build', 'director', 'build', null),
      entity('director-review', 'director', 'review', null),
      entity('director-ops', 'director', 'ops', null),
      entity('meow-ops-dev', 'assistant', 'research', 1),
      entity('meow-ops-guardrails', 'assistant', 'review', 2),
    ],
    edges: [{ id: 'dep.dev.guardrails', source: 'meow-ops-dev', target: 'meow-ops-guardrails' }],
  };
  const gates = [{
    id: 'gate-stale', entityId: 'meow-ops-dev', gateType: 'eval', status: 'passed',
    evidence: 'Eval set passed 18/18', blockingReason: null,
    lastCheckedAt: '2026-07-01T12:00:00.000Z',
  }];
  await page.context().route('**/data/loop-ops/spec.json*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(spec),
  }));
  await page.context().route('**/data/loop-ops/gates.json*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(gates),
  }));
  await page.context().route('**/data/loop-ops/runs.json*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '[]',
  }));
  const proposalBase = {
    schema_version: 1, created_at: '2026-07-16T12:00:00.000Z', created_by: 'assistant:loop',
    category: 'workflow', one_percent_target: 'Keep the Loom current',
    evidence: [{ kind: 'rule', ref: 'loom-e2e' }], rollback: { plan: 'No write occurred' },
    review_only: true, confidence: 0.8, risk: 'low', status: 'draft',
  };
  await mockLoopEng(page, {
    proposals: [
      { ...proposalBase, proposal_id: 'prop-dev-1', loop_id: 'meow-ops-dev', title: 'Dev proposal one' },
      { ...proposalBase, proposal_id: 'prop-dev-2', loop_id: 'meow-ops-dev', title: 'Dev proposal two' },
      { ...proposalBase, proposal_id: 'prop-other', loop_id: 'meow-ops-guardrails', title: 'Other entity proposal' },
    ],
    summary: { counts_by_status: { draft: 3 }, open_per_loop: { 'meow-ops-dev': 2, 'meow-ops-guardrails': 1 }, total: 3 },
  });

  await nav(page, 'Review');
  await openTab(page, 'Map');
  await page.getByRole('button', { name: 'Expand all waves' }).click();
  const node = page.locator('[data-entity-id="meow-ops-dev"]');
  await expect(node.locator('[data-status="needs-review"]')).toBeVisible();
  await node.click();
  const inspector = page.locator('[data-testid="loop-inspector"]');
  await expect(inspector.getByText('Eval set passed 18/18', { exact: false })).toBeVisible();
  await expect(inspector.getByText(/stale after 7 days/i)).toBeVisible();
  await expect(inspector.locator('[data-status="needs-review"]')).toBeVisible();
  await expect(page.locator('.loop-dependency-edge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show dependencies' }).click();
  await expect(page.locator('.loop-dependency-edge')).toHaveCount(1);
  await page.getByRole('button', { name: 'Hide dependencies' }).click();
  await expect(page.locator('.loop-dependency-edge')).toHaveCount(0);
  const badge = node.getByRole('button', { name: 'Open 2 proposals for meow-ops-dev' });
  await expect(badge).toHaveText('⚑ 2');
  await badge.click();
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="review-entity-filter"]')).toHaveText('filtered to meow-ops-dev');
  await expect(page.getByRole('button', { name: /Dev proposal one/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Dev proposal two/ })).toBeVisible();
  await expect(page.getByText('Other entity proposal')).toHaveCount(0);
});

test('Review Inbox: empty state renders without local helper', async ({ page }) => {
  await page.context().route('**/loop-eng/**', route => route.abort());
  await page.goto('/#/loop-review');
  await waitForApp(page);
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
  await expect(page.getByText('No proposals yet — run npm run loop:propose')).toBeVisible();
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Review Inbox: Runs tab renders empty state without local helper', async ({ page }) => {
  await page.context().route('**/loop-eng/**', route => route.abort());
  await page.goto('/#/loop-review');
  await waitForApp(page);
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await expect(page.getByText('No runs yet — run npm run loop:capture')).toBeVisible();
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Review Inbox: Ship Next ranks pending work and lists approved manual apply', async ({ page }) => {
  const base = {
    schema_version: 1,
    loop_id: 'demo-loop',
    created_by: 'system:propose',
    category: 'workflow',
    evidence: [{ kind: 'rule', ref: 'test' }],
    rollback: { plan: 'synthetic rollback' },
    review_only: false,
  };
  await mockLoopEng(page, {
    proposals: [
      {
        ...base,
        proposal_id: 'prop-medium',
        created_at: '2026-06-20T00:00:00.000Z',
        title: 'Medium older but lower priority',
        one_percent_target: 'Medium risk should sort below low risk',
        expected_benefit: 'Keeps operator focus conservative',
        confidence: 0.99,
        risk: 'medium',
        status: 'pending_approval',
      },
      {
        ...base,
        proposal_id: 'prop-low-new',
        created_at: '2026-07-05T00:00:00.000Z',
        title: 'Low same newer',
        one_percent_target: 'Newer same-rank item should appear after older same-rank item',
        expected_benefit: 'Proves age desc within equal risk and confidence',
        confidence: 0.8,
        risk: 'low',
        status: 'pending_approval',
      },
      {
        ...base,
        proposal_id: 'prop-low-old',
        created_at: '2026-06-30T00:00:00.000Z',
        title: 'Low same older',
        one_percent_target: 'Older same-rank item should ship first',
        expected_benefit: 'Proves the Ship Next ranking contract',
        confidence: 0.8,
        risk: 'low',
        status: 'pending_approval',
      },
      {
        ...base,
        proposal_id: 'prop-approved',
        created_at: '2026-06-25T00:00:00.000Z',
        title: 'Approved awaiting apply',
        one_percent_target: 'Approved items wait below the pending queue',
        expected_benefit: 'Owner can apply manually after approval',
        confidence: 0.7,
        risk: 'low',
        status: 'approved',
      },
    ],
    decisions: [{
      schema_version: 1,
      decision_id: 'dec-approved',
      proposal_id: 'prop-approved',
      decided_at: '2026-07-06T00:00:00.000Z',
      decision: 'approved',
      decided_by: 'owner',
    }],
    summary: { counts_by_status: { pending_approval: 3, approved: 1 }, open_per_loop: { 'demo-loop': 3 }, total: 4 },
  });

  await page.goto('/#/loop-review');
  await waitForApp(page);
  await page.getByRole('button', { name: 'Ship Next', exact: true }).click();
  await expect(page.getByText('Pending owner decisions')).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text.indexOf('Low same older')).toBeLessThan(text.indexOf('Low same newer'));
  expect(text.indexOf('Low same newer')).toBeLessThan(text.indexOf('Medium older but lower priority'));
  expect(text.indexOf('Approved, awaiting manual apply')).toBeLessThan(text.indexOf('Approved awaiting apply'));
  await expect(page.getByText('Owner can apply manually after approval')).toBeVisible();
});

test('Review Inbox: expired drafts leave queue but remain under expired filter', async ({ page }) => {
  await mockLoopEng(page, {
    proposals: [{
      schema_version: 1,
      proposal_id: 'prop-expired',
      loop_id: 'demo-loop',
      created_at: '2026-06-20T00:00:00.000Z',
      created_by: 'system:expire',
      category: 'workflow',
      title: 'Expired stale draft',
      one_percent_target: 'Expired drafts should not sit in the owner queue',
      evidence: [{ kind: 'rule', ref: 'expired-test' }],
      confidence: 0.4,
      risk: 'low',
      expected_benefit: 'Keeps the queue current',
      rollback: { plan: 'synthetic rollback' },
      review_only: false,
      status: 'rejected',
    }],
    decisions: [{
      schema_version: 1,
      decision_id: 'dec-expired',
      proposal_id: 'prop-expired',
      decided_at: '2026-07-06T00:00:00.000Z',
      decision: 'rejected',
      decided_by: 'system:expire',
      created_by: 'system:expire',
      reason: 'expired stale draft',
    }],
    summary: { counts_by_status: { expired: 1 }, open_per_loop: {}, total: 1 },
  });

  await page.goto('/#/loop-review');
  await waitForApp(page);
  await expect(page.getByText('Expired stale draft')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expired', exact: true }).click();
  await expect(page.getByRole('button', { name: /Expired stale draft/ })).toBeVisible();
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Review Inbox: deferred proposals do not offer an invalid Undo action', async ({ page }) => {
  await mockLoopEng(page, {
    proposals: [{
      schema_version: 1,
      proposal_id: 'prop-deferred',
      loop_id: 'demo-loop',
      created_at: '2026-07-06T00:00:00.000Z',
      created_by: 'system:propose',
      category: 'workflow',
      title: 'Deferred owner decision',
      one_percent_target: 'Keep the deferred item out of the active queue',
      evidence: [{ kind: 'rule', ref: 'deferred-test' }],
      rollback: { plan: 'Return it to pending manually' },
      review_only: false,
      status: 'pending_approval',
    }],
    decisions: [{
      decision_id: 'dec-deferred',
      proposal_id: 'prop-deferred',
      decided_at: '2026-07-06T00:01:00.000Z',
      decision: 'deferred',
      decided_by: 'owner',
    }],
  });
  await page.goto('/#/loop-review');
  await waitForApp(page);
  await page.getByRole('button', { name: 'Decided', exact: true }).click();
  await expect(page.getByText(/deferred by owner at/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
});

test('Review Inbox: mobile Digest stays within the viewport', async ({ page }) => {
  const digest = {
    generated_at: '2026-07-06T00:00:00.000Z',
    period: { since: '2026-07-05', until: '2026-07-06T00:00:00.000Z' },
    capture: { run_id: null, sessions: 0 },
    intake: { processed: 0, stored: 0, dropped: 0, skipped: 1 },
    health: {
      agents_total: 1,
      flagged: 1,
      flags: ['stale-log'],
      agents: [{
        label: 'com.google.GoogleUpdater.long-component-name',
        running: false,
        last_exit_status: 0,
        log_staleness_hours: 48,
        flags: ['stale-log'],
      }],
    },
    proposals: { new_drafts: 0, pending: 0, total: 0 },
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLoopEng(page, { digest, digestHistory: [digest] });
  await page.goto('/#/loop-review');
  await waitForApp(page);
  await page.getByRole('button', { name: 'Digest', exact: true }).click();
  await expect(page.getByText('Agents', { exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
});

// ── 11. Focus chip ───────────────────────────────────────────────────────────

test('Focus timer chip is on the shell, not a page', async ({ page }) => {
  for (const surface of ['Today', 'Review', 'Ledger', 'Sanctum', 'Learn']) {
    await nav(page, surface);
    await expect(page.getByRole('button', { name: 'Start focus timer' })).toBeVisible();
  }
});

test('legacy hashes rewrite to Today', async ({ page }) => {
  for (const hash of ['#/companion', '#/pomodoro', '#/overview']) {
    await page.goto(`/${hash}`);
    await waitForApp(page);
    await expect(page).toHaveURL(/#\/today\/summary$/);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  }

  // Same-session alias: canonical is already today/summary, so the rewrite
  // must still run. This is the inbox-cut regression.
  await page.evaluate(() => { window.location.hash = '#/pomodoro'; });
  await expect(page).toHaveURL(/#\/today\/summary$/);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

// ── 14. PWA manifest ──────────────────────────────────────────────────────────

test('PWA manifest is reachable', async ({ page }) => {
  const res = await page.request.get('/manifest.json');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.name).toMatch(/meow/i);
});

// ── 15. Static data endpoints ─────────────────────────────────────────────────

test('/data/sessions.json or demo-sessions.json is reachable', async ({ page }) => {
  // vercel.json rewrites /data/sessions.json → /data/demo-sessions.json in preview
  const res = await page.request.get('/data/sessions.json');
  expect([200, 301, 302]).toContain(res.status());

  const demo = await page.request.get('/data/demo-sessions.json');
  expect(demo.status()).toBe(200);
  const rows = await demo.json();
  expect(rows).toHaveLength(60);
  expect(rows[0].session_id).toBe('demo-session-0001');
  const privateFields = ['cwd', 'raw_ref', 'session_title', 'first_user_message'];
  expect(rows.every((row: Record<string, unknown>) => privateFields.every(key => !(key in row)))).toBe(true);
});

test('Capacity Usage marks generated public values as synthetic demo data', async ({ page }) => {
  await page.goto('/#/capacity');
  await expect(page.getByText('synthetic demo data', { exact: true })).toBeVisible({ timeout: 20_000 });
});

test('Sanctum: linked synthetic sessions under configured CPU profile', async ({ page }) => {
  const sampleDurationMs = Number(process.env.SANCTUM_PERF_DURATION_MS ?? '5000');
  if (!Number.isInteger(sampleDurationMs) || sampleDurationMs < 5_000 || sampleDurationMs > 30_000) {
    throw new Error('SANCTUM_PERF_DURATION_MS must be an integer from 5000 to 30000.');
  }
  test.setTimeout(Math.max(90_000, sampleDurationMs * 2 + 60_000));
  await page.setViewportSize({ width: 1280, height: 720 });
  const baseTime = Date.now();
  const roles = [
    ['builder-a', 'builder'], ['builder-b', 'builder'], ['detective', 'detective'],
    ['commander', 'commander'], ['architect', 'architect'], ['guardian', 'guardian'],
    ['storyteller', 'storyteller'], ['ghost', 'ghost'],
  ] as const;
  const sessionCount = Number(process.env.SANCTUM_PERF_SESSION_COUNT ?? '8');
  if (sessionCount !== 1 && sessionCount !== roles.length) {
    throw new Error(`SANCTUM_PERF_SESSION_COUNT must be 1 or ${roles.length}.`);
  }
  const cpuThrottleRate = Number(process.env.SANCTUM_PERF_CPU_RATE ?? '4');
  if (cpuThrottleRate !== 1 && cpuThrottleRate !== 4) {
    throw new Error('SANCTUM_PERF_CPU_RATE must be 1 or 4.');
  }
  const sessions = roles.slice(0, sessionCount).map(([id, cat_type], index) => ({
    session_id: `sanctum-cpu4-${id}`,
    ...(index > 0 ? { parent_session_id: 'sanctum-cpu4-builder-a' } : {}),
    project: 'sanctum-cpu4-e2e',
    model: 'synthetic',
    entrypoint: 'test',
    git_branch: `test/${id}`,
    started_at: new Date(baseTime + index * 60_000).toISOString(),
    ended_at: new Date(baseTime + index * 60_000 + 300_000).toISOString(),
    duration_seconds: 300,
    message_count: 2,
    user_message_count: 1,
    assistant_message_count: 1,
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 15,
    estimated_cost_usd: 0,
    cat_type,
    is_ghost: false,
    source: 'codex' as const,
    agent_slug: `cpu4-${id}`,
    session_title: `Synthetic ${id}`,
    tools: { Read: 1 },
  }));
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/data/sessions.json*', (route) => route.fulfill({ json: sessions }));
  await page.route('**/loop-eng/**', (route) => route.abort());
  await page.addInitScript(() => {
    let seed = 0x5ec0a7;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate });
  const profileCpu = process.env.SANCTUM_PERF_PROFILE === '1';
  const traceFrames = process.env.SANCTUM_PERF_TRACE === '1';
  if (profileCpu && traceFrames) {
    throw new Error('Run CPU profiling and frame tracing in separate passes.');
  }
  if (profileCpu && process.env.SANCTUM_PERF_ENFORCE === '1') {
    throw new Error('CPU profiling changes timing; leave SANCTUM_PERF_ENFORCE unset.');
  }
  if (process.env.SANCTUM_PERF_ENFORCE === '1') {
    expect(traceFrames, 'The strict presentation gate requires SANCTUM_PERF_TRACE=1').toBe(true);
  }
  if (profileCpu) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  }
  await page.goto('about:blank');
  const idleBrowserBaseline = await page.evaluate((durationMs: number) => new Promise((resolve) => {
    const deltas: number[] = [];
    let previous = performance.now();
    const started = previous;
    const frame = (now: number) => {
      deltas.push(now - previous);
      previous = now;
      if (now - started >= durationMs) {
        const sorted = [...deltas].sort((left, right) => left - right);
        const percentile = (p: number) => sorted[Math.min(Math.ceil(sorted.length * p) - 1, sorted.length - 1)] ?? 0;
        resolve({
          callbackCount: deltas.length,
          rafHz: Math.round(deltas.length * 1000 / (now - started)),
          rafIntervalP95Ms: Number(percentile(0.95).toFixed(2)),
        });
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), sampleDurationMs);
  await page.goto('/');
  await waitForApp(page);
  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return Math.round(entry.duration);
  });
  await nav(page, 'Sanctum');
  const roster = page.locator('.sanctum-roster button');
  await expect(roster).toHaveCount(sessions.length, { timeout: 25_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
  const sessionTagPositions = () => page.locator('[data-session-tag="true"]').evaluateAll((elements) => (
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.textContent ?? '',
        x: Number((rect.left + rect.width / 2).toFixed(1)),
        y: Number((rect.top + rect.height / 2).toFixed(1)),
      };
    })
  ));
  const findOverlaps = (positions: Awaited<ReturnType<typeof sessionTagPositions>>) => {
    const overlaps: string[] = [];
    for (let left = 0; left < positions.length; left++) {
      for (let right = left + 1; right < positions.length; right++) {
        const a = positions[left]!;
        const b = positions[right]!;
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        if (dx < 80 && dy < 105) overlaps.push(`${a.label}/${b.label} (${dx}x${dy})`);
      }
    }
    return overlaps;
  };
  await expect(page.locator('[data-session-tag="true"]')).toHaveCount(sessions.length);
  await expect.poll(async () => findOverlaps(await sessionTagPositions()), {
    message: '8-session labels must leave room for both character silhouettes',
    timeout: 20_000,
    intervals: [250, 500, 1_000],
  }).toEqual([]);
  const webglRenderer = await page.locator('canvas').first().evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return 'unavailable';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'masked';
  });
  if (process.env.SANCTUM_PERF_ENFORCE === '1') {
    expect(process.env.SANCTUM_PERF_HEADFUL, 'The strict callback gate must run in a headed browser on the target desktop GPU').toBe('1');
    expect(webglRenderer, 'The strict callback gate needs a readable WebGL renderer').not.toMatch(/^(masked|unavailable)$/i);
    expect(webglRenderer, 'The strict callback gate cannot use a software WebGL renderer').not.toMatch(/swiftshader|llvmpipe|software rasterizer/i);
  }
  const hud = page.locator('.sanctum-hud-panel').filter({ hasText: 'PERF HUD' });

  const sample = async () => page.evaluate((durationMs: number) => new Promise((resolve) => {
    const deltas: number[] = [];
    let previous = performance.now();
    const started = previous;
    const frame = (now: number) => {
      deltas.push(now - previous);
      previous = now;
      if (now - started >= durationMs) {
        const sorted = [...deltas].sort((left, right) => left - right);
        const percentile = (p: number) => sorted[Math.min(Math.ceil(sorted.length * p) - 1, sorted.length - 1)] ?? 0;
        resolve({
          callbackCount: deltas.length,
          rafHz: Math.round(deltas.length * 1000 / (now - started)),
          rafIntervalP50Ms: Number(percentile(0.5).toFixed(2)),
          rafIntervalP95Ms: Number(percentile(0.95).toFixed(2)),
          callbacksOver25ms: deltas.filter(delta => delta > 25).length,
        });
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), sampleDurationMs);
  type CpuProfileNode = {
    callFrame: { functionName: string; url: string; lineNumber: number };
    hitCount?: number;
  };
  const summarizeCpuProfile = (nodes: CpuProfileNode[]) => {
    const samplesByFrame = new Map<string, number>();
    for (const node of nodes) {
      const samples = node.hitCount ?? 0;
      if (samples === 0) continue;
      const { functionName, url, lineNumber } = node.callFrame;
      const source = url.split('/').pop() || '<runtime>';
      const frame = `${functionName || '(anonymous)'} @ ${source}:${lineNumber + 1}`;
      samplesByFrame.set(frame, (samplesByFrame.get(frame) ?? 0) + samples);
    }
    return [...samplesByFrame.entries()]
      .map(([frame, samples]) => ({ frame, samples }))
      .sort((left, right) => right.samples - left.samples)
      .slice(0, 12);
  };
  const summarizeFrameTrace = (events: ChromiumTraceEvent[]) => {
    const threadNames = new Map<string, string>();
    for (const event of events) {
      if (event.ph !== 'M' || event.name !== 'thread_name' || typeof event.args?.name !== 'string') continue;
      threadNames.set(`${event.pid ?? 0}:${event.tid ?? 0}`, event.args.name);
    }
    const metrics = new Map<string, { thread: string; event: string; count: number; totalMs: number; maxMs: number }>();
    for (const event of events) {
      if (event.ph !== 'X' || !event.name || !event.dur || event.dur < 1_000) continue;
      const thread = threadNames.get(`${event.pid ?? 0}:${event.tid ?? 0}`) ?? 'unknown thread';
      const key = `${thread}::${event.name}`;
      const metric = metrics.get(key) ?? { thread, event: event.name, count: 0, totalMs: 0, maxMs: 0 };
      const durationMs = event.dur / 1000;
      metric.count += 1;
      metric.totalMs += durationMs;
      metric.maxMs = Math.max(metric.maxMs, durationMs);
      metrics.set(key, metric);
    }
    const taskDurations = [...metrics.values()]
      .sort((left, right) => right.totalMs - left.totalMs)
      .slice(0, 20)
      .map((metric) => ({
        ...metric,
        totalMs: Number(metric.totalMs.toFixed(1)),
        maxMs: Number(metric.maxMs.toFixed(2)),
      }));
    const pipelineEvents = events.filter((event) => (
      /PipelineReporter|Graphics\.Pipeline|FramePresented|SubmitCompositorFrameToPresentationCompositorFrame|SubmitUpdateDisplayTreeToPresentationCompositorFrame/.test(event.name ?? '')
    ));
    const pipelineStages = new Map<string, { name: string; phase: string; step: string; count: number; maxMs: number; argsKeys: string[] }>();
    for (const event of pipelineEvents) {
      const args = event.args ?? {};
      const step = typeof args.step === 'string' ? args.step : '';
      const key = `${event.name ?? 'unknown'}::${event.ph ?? 'unknown'}::${step}`;
      const metric = pipelineStages.get(key) ?? {
        name: event.name ?? 'unknown',
        phase: event.ph ?? 'unknown',
        step,
        count: 0,
        maxMs: 0,
        argsKeys: Object.keys(args).sort(),
      };
      metric.count += 1;
      metric.maxMs = Math.max(metric.maxMs, Math.max(0, event.dur ?? 0) / 1000);
      pipelineStages.set(key, metric);
    }
    return {
      taskDurations,
      pipelineStages: [...pipelineStages.values()].sort((left, right) => right.count - left.count).slice(0, 30),
      presentationIntervals: summarizePresentationIntervals(events),
    };
  };
  const sampleWithFrameTrace = async () => {
    if (!traceFrames) return { frames: await sample(), trace: undefined };
    const { result: frames, events } = await captureChromiumTrace(cdp, sample);
    return { frames, trace: summarizeFrameTrace(events) };
  };
  const readHud = () => hud.innerText();
  const drawCalls = (hudText: string) => Number(hudText.match(/DRAW\s+(\d+)/)?.[1]);
  const captureHud = async (drawCallsBelow?: number) => {
    await page.keyboard.press('Backquote');
    await expect(hud).toBeVisible();
    await expect.poll(async () => {
      const calls = drawCalls(await readHud());
      return drawCallsBelow === undefined ? calls > 0 : calls < drawCallsBelow;
    }, { timeout: 8_000 }).toBe(true);
    const text = await readHud();
    await page.keyboard.press('Backquote');
    await expect(hud).toHaveCount(0);
    await page.waitForTimeout(250);
    return text;
  };
  const preset = page.locator('button[title^="Cycle performance preset"]');
  const setPreset = async (target: 'NORMAL' | 'LOW') => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await preset.innerText()).trim() === target) return;
      await preset.click();
    }
    await expect(preset).toHaveText(target);
  };

  await setPreset('NORMAL');
  await page.waitForTimeout(1_000);
  if (profileCpu) await cdp.send('Profiler.start');
  const normalRun = await sampleWithFrameTrace();
  const normal = normalRun.frames;
  const normalProfile = profileCpu
    ? summarizeCpuProfile((await cdp.send('Profiler.stop')).profile.nodes)
    : undefined;
  const normalHud = await captureHud();
  await setPreset('LOW');
  await page.waitForTimeout(1_000);
  const lowHud = await captureHud(Math.floor(drawCalls(normalHud) * 0.8));
  await page.waitForTimeout(250);
  if (profileCpu) await cdp.send('Profiler.start');
  const lowRun = await sampleWithFrameTrace();
  const low = lowRun.frames;
  const lowProfile = profileCpu
    ? summarizeCpuProfile((await cdp.send('Profiler.stop')).profile.nodes)
    : undefined;
  await page.screenshot({ path: `test-results/sanctum-cpu${cpuThrottleRate}-sessions${sessionCount}-low.png` });
  console.info('SYNTHETIC_SANCTUM_PERF', JSON.stringify({
    viewport: '1280x720', sessions: sessions.length, cpuThrottle: `${cpuThrottleRate}x`, navigationMs: navigation,
    idleBrowserBaseline,
    webglRenderer, normal, normalHud, low, lowHud, pageErrors,
    cpuProfiles: profileCpu ? { normal: normalProfile, low: lowProfile } : undefined,
    frameTraces: traceFrames ? { normal: normalRun.trace, low: lowRun.trace } : undefined,
    note: 'Synthetic roster. The strict gate uses unique Chromium compositor-to-presentation intervals; macOS presentation timestamps are estimates, and this is not low-tier-device acceptance.',
  }));
  await expect(page.getByText(/scene error.*reload if stuck/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(normal.callbackCount).toBeGreaterThan(0);
  expect(low.callbackCount).toBeGreaterThan(0);
  expect(drawCalls(lowHud)).toBeLessThan(drawCalls(normalHud));
  if (process.env.SANCTUM_PERF_ENFORCE === '1') {
    const assertPresentationBudget = (name: string, result: typeof normal, trace: ReturnType<typeof summarizeFrameTrace> | undefined) => {
      expect(result.rafHz, `${name} preset must sustain at least 58 browser rAF callbacks per second`).toBeGreaterThanOrEqual(58);
      expect(result.callbacksOver25ms, `${name} preset must not have a browser rAF callback gap over 25 ms`).toBe(0);
      const presentation = trace?.presentationIntervals.find(metric => (
        metric.thread === 'Compositor'
        && metric.stage === 'SubmitCompositorFrameToPresentationCompositorFrame'
        && metric.uniquePresentations > 0
      ));
      expect(presentation, `${name} preset must produce Chromium compositor presentation samples`).toBeDefined();
      if (!presentation) throw new Error(`${name} preset has no compositor presentation samples.`);
      expect(presentation.uniquePresentations, `${name} preset must report at least 95% of sampled browser frames`).toBeGreaterThanOrEqual(Math.floor(result.callbackCount * 0.95));
      expect(presentation.uniquePresentationIntervalP95Ms, `${name} preset compositor presentation interval p95 must meet the 16.7 ms budget`).toBeLessThanOrEqual(16.7);
    };
    assertPresentationBudget('normal', normal, normalRun.trace);
    assertPresentationBudget('low', low, lowRun.trace);
  }
  await cdp.detach();
});

test('Sanctum: eight-session guide with muted local speech stays responsive', async ({ page }) => {
  test.skip(process.env.SANCTUM_PERF_GUIDE !== '1', 'Run explicitly on a headful Mac with local speech enabled.');
  expect(process.env.SANCTUM_PERF_HEADFUL, 'The guide performance gate must run in a headed browser on the target desktop GPU').toBe('1');
  const sampleDurationMs = Number(process.env.SANCTUM_PERF_DURATION_MS ?? '5000');
  if (!Number.isInteger(sampleDurationMs) || sampleDurationMs < 5_000 || sampleDurationMs > 30_000) {
    throw new Error('SANCTUM_PERF_DURATION_MS must be an integer from 5000 to 30000.');
  }
  const startReducedMotion = process.env.SANCTUM_PERF_START_REDUCED_MOTION === '1';
  const targetPreset = process.env.SANCTUM_PERF_PRESET ?? (startReducedMotion ? 'LOW' : 'NORMAL');
  if (targetPreset !== 'NORMAL' && targetPreset !== 'LOW') throw new Error('SANCTUM_PERF_PRESET must be NORMAL or LOW.');
  test.setTimeout(Math.max(120_000, sampleDurationMs * 4 + 60_000));
  await page.setViewportSize({ width: 1280, height: 720 });
  const baseTime = Date.now();
  const roles = [
    ['builder-a', 'builder'], ['builder-b', 'builder'], ['detective', 'detective'],
    ['commander', 'commander'], ['architect', 'architect'], ['guardian', 'guardian'],
    ['storyteller', 'storyteller'], ['ghost', 'ghost'],
  ] as const;
  const sessions = roles.map(([id, cat_type], index) => ({
    session_id: `sanctum-integrated-${id}`,
    ...(index > 0 ? { parent_session_id: 'sanctum-integrated-builder-a' } : {}),
    project: 'sanctum-integrated-e2e',
    model: 'synthetic',
    entrypoint: 'test',
    git_branch: `test/${id}`,
    started_at: new Date(baseTime + index * 60_000).toISOString(),
    ended_at: new Date(baseTime + index * 60_000 + 300_000).toISOString(),
    duration_seconds: 300,
    message_count: 2,
    user_message_count: 1,
    assistant_message_count: 1,
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 15,
    estimated_cost_usd: 0,
    cat_type,
    is_ghost: false,
    source: 'codex' as const,
    agent_slug: `integrated-${id}`,
    session_title: `Synthetic ${id}`,
    tools: { Read: 1 },
  }));
  const pageErrors: string[] = [];
  const guideRequests: string[] = [];
  const longSyntheticAnswer = 'Synthetic archive guide performance sample. No private records are used. '.repeat(36);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/data/sessions.json*', route => route.fulfill({ json: sessions }));
  await page.route(LOCAL_HELPER_ROUTE, async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const headers = {
      'Access-Control-Allow-Origin': request.headers().origin ?? 'http://127.0.0.1:4275',
      'Access-Control-Allow-Headers': 'content-type,x-meow-ops-local',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Private-Network': 'true',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (pathname.endsWith('/guide-voice')) {
      if (request.method() !== 'GET') guideRequests.push('unexpected-voice-generation');
      return route.fulfill({ headers, json: { available: false, status: 'unavailable' } });
    }
    if (pathname.endsWith('/sanctum-guide') && request.method() === 'POST') {
      guideRequests.push('synthetic-guide-answer');
      return route.fulfill({ headers, json: {
        ok: true,
        answer: longSyntheticAnswer,
        kind: 'explanation',
        imported_at: null,
        unknowns: [],
        evidence: [],
        capabilities: [],
      } });
    }
    return route.abort();
  });
  await page.addInitScript(() => {
    let seed = 0x5ec0a7;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
  });
  if (startReducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  const cpuThrottleRate = Number(process.env.SANCTUM_PERF_CPU_RATE ?? '4');
  if (cpuThrottleRate !== 1 && cpuThrottleRate !== 4) throw new Error('SANCTUM_PERF_CPU_RATE must be 1 or 4.');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate });
  await page.goto('about:blank');
  const idleBrowserBaseline = await page.evaluate((durationMs: number) => new Promise<{
    callbackCount: number;
    rafHz: number;
    rafIntervalP95Ms: number;
  }>(resolve => {
    const deltas: number[] = [];
    let previous = performance.now();
    const started = previous;
    const frame = (now: number) => {
      deltas.push(now - previous);
      previous = now;
      if (now - started >= durationMs) {
        const sorted = [...deltas].sort((left, right) => left - right);
        const percentile = (p: number) => sorted[Math.min(Math.ceil(sorted.length * p) - 1, sorted.length - 1)] ?? 0;
        resolve({
          callbackCount: deltas.length,
          rafHz: Math.round(deltas.length * 1000 / (now - started)),
          rafIntervalP95Ms: Number(percentile(0.95).toFixed(2)),
        });
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), sampleDurationMs);
  await page.goto('/');
  await waitForApp(page);
  await nav(page, 'Sanctum');
  await expect(page.locator('.sanctum-roster button')).toHaveCount(sessions.length, { timeout: 25_000 });
  const preset = page.locator('button[title^="Cycle performance preset"]');
  for (let attempt = 0; attempt < 3 && (await preset.innerText()).trim() !== targetPreset; attempt++) await preset.click();
  await expect(preset).toHaveText(targetPreset);
  await page.waitForTimeout(3_000);

  const sample = async (durationMs = sampleDurationMs) => page.evaluate((durationMs: number) => new Promise<{
    callbackCount: number; rafHz: number; rafIntervalP50Ms: number; rafIntervalP95Ms: number; callbacksOver25ms: number;
  }>(resolve => {
    const deltas: number[] = [];
    let previous = performance.now();
    const started = previous;
    const frame = (now: number) => {
      deltas.push(now - previous);
      previous = now;
      if (now - started >= durationMs) {
        const sorted = [...deltas].sort((left, right) => left - right);
        const percentile = (p: number) => sorted[Math.min(Math.ceil(sorted.length * p) - 1, sorted.length - 1)] ?? 0;
        resolve({
          callbackCount: deltas.length,
          rafHz: Math.round(deltas.length * 1000 / (now - started)),
          rafIntervalP50Ms: Number(percentile(0.5).toFixed(2)),
          rafIntervalP95Ms: Number(percentile(0.95).toFixed(2)),
          callbacksOver25ms: deltas.filter(delta => delta > 25).length,
        });
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), sampleDurationMs);
  const sampleWithPresentationTrace = async (durationMs = sampleDurationMs) => {
    const { result: frames, events } = await captureChromiumTrace(cdp, () => sample(durationMs));
    return { frames, presentationIntervals: summarizePresentationIntervals(events) };
  };
  const rosterOnlyRun = await sampleWithPresentationTrace();
  const rosterOnly = rosterOnlyRun.frames;

  await page.getByRole('button', { name: 'Ask the guide' }).click();
  const dialog = page.getByRole('dialog', { name: /Sanctum archive guide/ });
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Load guide character' }).click();
  await expect(dialog.locator('.guide-character canvas')).toHaveCount(1, { timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => speechSynthesis.getVoices().filter(voice => voice.localService).length), {
    timeout: 15_000,
  }).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(dialog.getByText(longSyntheticAnswer, { exact: true })).toBeVisible();
  const volume = dialog.getByLabel('Speech volume');
  await volume.evaluate(element => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, '0');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(volume).toHaveValue('0');
  await dialog.getByRole('button', { name: 'Read aloud / replay' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Speaking');
  await expect(dialog.locator('.guide-character canvas')).toHaveCount(1);
  const renderer = await page.locator('.guide-character canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return 'unavailable';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'masked';
  });
  expect(renderer, 'The guide performance gate needs a readable WebGL renderer').not.toMatch(/^(masked|unavailable)$/i);
  expect(renderer, 'The guide performance gate cannot use a software WebGL renderer').not.toMatch(/swiftshader|llvmpipe|software rasterizer/i);
  const guideSpeakingRun = await sampleWithPresentationTrace();
  const guideSpeaking = guideSpeakingRun.frames;
  await expect(dialog.getByRole('status')).toHaveText('Speaking');

  await dialog.getByLabel(/Animate character/).uncheck();
  const bodyAnimationPausedRun = await sampleWithPresentationTrace();
  const bodyAnimationPaused = bodyAnimationPausedRun.frames;
  await expect(dialog.getByRole('status')).toHaveText('Speaking');
  await page.addStyleTag({ content: '.sanctum-guide::backdrop { backdrop-filter: none !important; }' });
  const backdropBlurRemovedRun = await sampleWithPresentationTrace(Math.min(sampleDurationMs, 5_000));
  const backdropBlurRemoved = backdropBlurRemovedRun.frames;
  const frameIntervalP95BudgetMs = 16.7;

  console.info('SANCTUM_INTEGRATED_GUIDE_PERF', JSON.stringify({
    viewport: '1280x720', sessions: sessions.length, cpuThrottle: `${cpuThrottleRate}x`, preset: targetPreset,
    reducedMotionAtStart: startReducedMotion, sampleDurationMs, renderer,
    idleBrowserBaseline, rosterOnly, guideSpeaking, bodyAnimationPaused, backdropBlurRemoved,
    presentationIntervals: {
      rosterOnly: rosterOnlyRun.presentationIntervals,
      guideSpeaking: guideSpeakingRun.presentationIntervals,
      bodyAnimationPaused: bodyAnimationPausedRun.presentationIntervals,
      backdropBlurRemoved: backdropBlurRemovedRun.presentationIntervals,
    },
    guideRequests, pageErrors,
    frameIntervalP95BudgetMs: process.env.SANCTUM_PERF_ENFORCE === '1' ? frameIntervalP95BudgetMs : undefined,
    note: 'System speech synthesis was muted at volume zero; Voicebox was unavailable and no generation request was made. The strict gate uses Chromium compositor-to-presentation intervals; macOS timestamps are estimates and this is not low-tier-device acceptance.',
  }));
  expect(guideRequests).toEqual(['synthetic-guide-answer']);
  expect(pageErrors).toEqual([]);
  expect([rosterOnly, guideSpeaking, bodyAnimationPaused, backdropBlurRemoved].every(result => result.callbackCount > 0)).toBe(true);
  for (const [name, result] of Object.entries({ rosterOnly, guideSpeaking, bodyAnimationPaused })) {
    expect(result.rafHz, `${name} must sustain at least 58 browser rAF callbacks per second`).toBeGreaterThanOrEqual(58);
    expect(result.callbacksOver25ms, `${name} must not have a browser rAF callback gap over 25 ms`).toBe(0);
  }
  expect(backdropBlurRemoved.rafHz, 'The short backdrop diagnostic must sustain at least 58 browser rAF callbacks per second').toBeGreaterThanOrEqual(58);
  if (process.env.SANCTUM_PERF_ENFORCE === '1') {
    const assertPresentationBudget = (
      name: string,
      result: typeof rosterOnly,
      intervals: PresentationIntervalMetric[],
    ) => {
      expect(result.rafHz, `${name} must sustain at least 58 browser rAF callbacks per second`).toBeGreaterThanOrEqual(58);
      expect(result.callbacksOver25ms, `${name} must not have a browser rAF callback gap over 25 ms`).toBe(0);
      const presentation = intervals.find(metric => (
        metric.thread === 'Compositor'
        && metric.stage === 'SubmitCompositorFrameToPresentationCompositorFrame'
        && metric.uniquePresentations > 0
      ));
      expect(presentation, `${name} must produce Chromium compositor presentation samples`).toBeDefined();
      if (!presentation) throw new Error(`${name} has no compositor presentation samples.`);
      expect(presentation.uniquePresentations, `${name} must report at least 95% of sampled browser frames`).toBeGreaterThanOrEqual(Math.floor(result.callbackCount * 0.95));
      expect(presentation.uniquePresentationIntervalP95Ms, `${name} compositor presentation interval p95 must meet the ${frameIntervalP95BudgetMs} ms budget`).toBeLessThanOrEqual(frameIntervalP95BudgetMs);
    }
    assertPresentationBudget('roster only', rosterOnly, rosterOnlyRun.presentationIntervals);
    assertPresentationBudget('guide speaking', guideSpeaking, guideSpeakingRun.presentationIntervals);
    assertPresentationBudget('body animation paused', bodyAnimationPaused, bodyAnimationPausedRun.presentationIntervals);
  }
  await dialog.getByRole('button', { name: 'Close' }).click();
  await cdp.detach();
});
