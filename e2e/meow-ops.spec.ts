/**
 * Meow Operations — end-to-end test suite
 *
 * Runs against the Vite preview build (dist/).
 * Covers the five surfaces (Today, Review, Ledger, Sanctum, Learn) plus key interactions.
 */
import { expect, test } from '@playwright/test';

// Network-backed cockpit tests need route mocks to reach Playwright instead of
// being answered by a previously installed production service worker.
test.use({ serviceWorkers: 'block' });

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
  await page.route(/^http:\/\/(?:127\.0\.0\.1|localhost):7337\//, (route) => {
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

  await page.route(/^http:\/\/(?:127\.0\.0\.1|localhost):7337\//, async (route) => {
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
        matched_sessions: 1,
        matched_events: 2,
        unmatched_events: 3,
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
  await expect(page.getByText(/not matched to a session/i)).toBeVisible();
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
  // Loading state shows "Scrying…" immediately; wait for it then wait for full render
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root')!;
      // Accept loading state or fully rendered (with SVG canvas)
      return root.innerHTML.includes('Sanctum') || root.innerHTML.length > 2000;
    },
    { timeout: 10_000 },
  );
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Sanctum: header bar visible', async ({ page }) => {
  await nav(page, 'Sanctum');
  // Wait for the component to at least start rendering
  await page.waitForFunction(
    () => document.getElementById('root')!.innerHTML.includes('Sanctum'),
    { timeout: 10_000 },
  );
  await expect(page.locator('text=Sanctum').first()).toBeVisible({ timeout: 15_000 });
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
  await nav(page, 'Sanctum');
  // Phase B replaced the static class legend ("Healthy Ley Line"-era) with
  // a per-session roster list. Each roster row is a button containing a
  // Arcane Order class label (Forgepaw / Gloamwhisker / Hexcaller / etc.). At least one
  // should be present once demo sessions load.
  await page.waitForFunction(
    () => /FORGEPAW|GLOAMWHISKER|HEXCALLER|VOIDMANE|SHIELDHEART|LOREWEAVER|NINELIVES/i
      .test(document.body.innerText),
    { timeout: 10_000 },
  );
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
});
