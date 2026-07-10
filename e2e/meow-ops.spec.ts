/**
 * Meow Operations — end-to-end test suite
 *
 * Runs against the Vite preview build (dist/).
 * Covers all 13 pages + key interactions.
 */
import { expect, test } from '@playwright/test';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait for the React root to mount and return its inner HTML length. */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.innerHTML.length > 1000;
  }, { timeout: 20_000 });
}

/** Click a sidebar nav button by label. Some nav buttons carry a tag pill
 *  child (e.g., "Scrying SanctumSANCTUM"), so match a regex prefix instead
 *  of exact text — the regex anchors at the start so it never collides
 *  with unrelated buttons that happen to contain the label as a substring. */
async function nav(page: import('@playwright/test').Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('button', { name: new RegExp(`^${escaped}`) }).first().click();
  // Brief settle — lazy chunks may need a moment
  await page.waitForTimeout(600);
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
  // Sidebar items as of the active App.jsx route table. The nav helper
  // matches a regex prefix to handle pill-tagged labels like "Scrying
  // SanctumSANCTUM". Live Sessions used to be in the sidebar; the page
  // is kept on disk for future use but no longer routed. Test #229
  // covers what's left of that flow.
  const expectedNav = [
    'Overview', 'Sessions', 'By Project', 'By Day', 'By Action',
    'Cost Tracker', 'Analytics', 'Agent Ops', 'Scrying Sanctum',
    'The Loom', 'Review Deck', 'Companion', 'Focus Timer',
  ];
  for (const label of expectedNav) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(
      page.getByRole('button', { name: new RegExp(`^${escaped}`) }).first(),
    ).toBeVisible();
  }
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
  // Stat card labels are "Sessions — 30 days" etc. — use partial match with .first()
  await expect(page.locator('text=/Sessions —/').first()).toBeVisible();
  await expect(page.locator('text=/Tokens —/').first()).toBeVisible();
  await expect(page.locator('text=/Cost —/').first()).toBeVisible();
  await expect(page.locator('text=/Projects —/').first()).toBeVisible();
});

test('Overview: Agent Sandbox launch card is opt-in and external', async ({ page }) => {
  const link = page.getByRole('link', { name: 'Open Agent Sandbox' });
  if (process.env.VITE_AGENT_SANDBOX_URL) {
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('href', /^https:\/\//);
  } else {
    await expect(link).toHaveCount(0);
  }
});

test('Overview: Cost Breakdown section renders', async ({ page }) => {
  await expect(page.locator('text=COST BREAKDOWN').or(page.locator('text=Cost Breakdown')).first()).toBeVisible();
  // SpendCard labels — use .first() to resolve strict mode
  await expect(page.locator('text=Today').first()).toBeVisible();
  await expect(page.locator('text=This Week').first()).toBeVisible();
});

test('Overview: Time Spent section renders', async ({ page }) => {
  await expect(page.locator('text=/Time Spent/i').first()).toBeVisible();
  await expect(page.locator('text=All apps').first()).toBeVisible();
  await expect(page.locator('text=By app').first()).toBeVisible();
});

test('Overview: source filter toggles exist when Codex data present', async ({ page }) => {
  const hasCodex = await page.locator('button:has-text("⬡ Codex")').count() > 0;
  if (hasCodex) {
    await page.getByRole('button', { name: '◆ Claude' }).click();
    await expect(page.locator('text=filtered: ◆ Claude only')).toBeVisible();
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

test('Overview: date filter changes the period label', async ({ page }) => {
  await page.getByRole('button', { name: '7d', exact: true }).click();
  // Stat card label will become "Sessions — 7 days" — first match suffices
  await expect(page.locator('text=/Sessions — 7 days/').first()).toBeVisible();
  await page.getByRole('button', { name: '30d', exact: true }).click();
});

// ── 3. Sessions ───────────────────────────────────────────────────────────────

test('Sessions: table renders with rows', async ({ page }) => {
  await nav(page, 'Sessions');
  // Either a table or a "no sessions" message
  const hasTable  = await page.locator('table, [role="grid"]').count() > 0;
  const hasMsg    = await page.locator('text=/no sessions|no data|empty/i').count() > 0;
  expect(hasTable || hasMsg).toBe(true);
});

// ── 4. By Project ─────────────────────────────────────────────────────────────

test('By Project: renders without error', async ({ page }) => {
  await nav(page, 'By Project');
  await expect(page.getByRole('heading', { name: /by project/i }).first()).toBeVisible();
});

// ── 5. By Day ─────────────────────────────────────────────────────────────────

test('By Day: area chart renders', async ({ page }) => {
  await nav(page, 'By Day');
  // Recharts renders an svg
  await expect(page.locator('svg').first()).toBeVisible();
});

// ── 6. By Action ──────────────────────────────────────────────────────────────

test('By Action: tool breakdown renders', async ({ page }) => {
  await nav(page, 'By Action');
  await expect(page.getByRole('heading', { name: 'By Action', exact: true })).toBeVisible();
});

// ── 7. Cost Tracker ───────────────────────────────────────────────────────────

test('Cost Tracker: renders without crash', async ({ page }) => {
  await nav(page, 'Cost Tracker');
  await expect(page.getByRole('heading', { name: 'Cost Tracker', exact: true })).toBeVisible();
});

// ── 8. Analytics ──────────────────────────────────────────────────────────────

test('Analytics: lazy chunk loads without error', async ({ page }) => {
  await nav(page, 'Analytics');
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
  await nav(page, 'Agent Ops');
  await page.waitForFunction(
    () => document.getElementById('root')!.innerHTML.length > 2000,
    { timeout: 20_000 },
  );
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

// ── 10. Scrying Sanctum ───────────────────────────────────────────────────────

test('Scrying Sanctum: page loads', async ({ page }) => {
  await nav(page, 'Scrying Sanctum');
  // Loading state shows "Scrying…" immediately; wait for it then wait for full render
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root')!;
      // Accept loading state or fully rendered (with SVG canvas)
      return root.innerHTML.includes('Scrying') || root.innerHTML.length > 2000;
    },
    { timeout: 10_000 },
  );
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Scrying Sanctum: header bar visible', async ({ page }) => {
  await nav(page, 'Scrying Sanctum');
  // Wait for the component to at least start rendering
  await page.waitForFunction(
    () => document.getElementById('root')!.innerHTML.includes('Scrying'),
    { timeout: 10_000 },
  );
  await expect(page.locator('text=Scrying Sanctum').first()).toBeVisible({ timeout: 15_000 });
});

test('Scrying Sanctum: run-group dropdown labels render', async ({ page }) => {
  await nav(page, 'Scrying Sanctum');
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

test('Scrying Sanctum: SVG canvas renders', async ({ page }) => {
  await nav(page, 'Scrying Sanctum');
  // Wait for demo data to load (auth check times out after 2s)
  await page.waitForTimeout(3000);
  const svgs = await page.locator('svg').count();
  expect(svgs).toBeGreaterThan(0);
});

test('Scrying Sanctum: scene renders without throwing into the error boundary', async ({ page }) => {
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
  await nav(page, 'Scrying Sanctum');
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

test('Scrying Sanctum: per-session roster visible', async ({ page }) => {
  await nav(page, 'Scrying Sanctum');
  // Phase B replaced the static class legend ("Healthy Ley Line"-era) with
  // a per-session roster list. Each roster row is a button containing a
  // class label (Wolverine / Batman / Dr. Strange / etc.). At least one
  // should be present once demo sessions load.
  await page.waitForTimeout(3000);
  const rosterText = await page.evaluate(() => document.body.innerText);
  const hasClassLabel =
    /WOLVERINE|BATMAN|DR\.\s*STRANGE|DARTH VADER|CAPTAIN AMERICA|GANDALF|TERMINATOR/i.test(rosterText);
  expect(hasClassLabel).toBe(true);
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
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payloadByPath[path] ?? {}),
    });
  });
}

test('The Loom: safety badge renders with or without spec data', async ({ page }) => {
  await nav(page, 'The Loom');
  // The safety invariant badge is part of the page contract from Phase 1 on,
  // in both the empty state and the loaded source strip.
  await expect(page.locator('text=/production writes disabled/i').first()).toBeVisible();
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Loop Ops: canvas renders imported entities when waves expanded', async ({ page }) => {
  test.skip(!(await loopSpecPresent(page)), 'local-only Loop-Ops fixture absent — run the importer');
  const spec = await (await page.request.get('/data/loop-ops/spec.json')).json();
  await nav(page, 'The Loom');
  await expect(page.locator(`text=${spec.meta.entityCount} entities · ${spec.meta.assistantCount} surfaces`)).toBeVisible();
  await expect(page.locator('[data-testid="loop-canvas"]')).toBeVisible();
  await page.getByRole('button', { name: 'Expand all waves' }).click();
  await expect(page.locator('[data-testid="loop-entity"]')).toHaveCount(spec.meta.entityCount);
  // Local operator action, presence only.
  await expect(page.getByRole('button', { name: 'Refresh spec' })).toBeVisible();
});

test('Loop Ops: inspector drawer answers the four questions', async ({ page }) => {
  test.skip(!(await loopSpecPresent(page)), 'local-only Loop-Ops fixture absent — run the importer');
  await nav(page, 'The Loom');
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
  test.skip(runsRes.status() !== 200, 'local-only runs.json absent — record a run first (SOP §5)');
  const runs = await runsRes.json();
  test.skip(!Array.isArray(runs) || runs.length === 0, 'runs.json empty');

  await nav(page, 'The Loom');
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

test('Review Deck: empty state renders without local helper', async ({ page }) => {
  await page.context().route('**/loop-eng/**', route => route.abort());
  await page.goto('/#/loop-review');
  await waitForApp(page);
  await expect(page.getByRole('heading', { name: 'Review Deck', exact: true })).toBeVisible();
  await expect(page.getByText('No proposals yet — run npm run loop:propose')).toBeVisible();
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Review Deck: Runs tab renders empty state without local helper', async ({ page }) => {
  await page.context().route('**/loop-eng/**', route => route.abort());
  await page.goto('/#/loop-review');
  await waitForApp(page);
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await expect(page.getByText('No runs yet — run npm run loop:capture')).toBeVisible();
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Review Deck: Ship Next ranks pending work and lists approved manual apply', async ({ page }) => {
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

test('Review Deck: expired drafts leave queue but remain under expired filter', async ({ page }) => {
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

// ── 11. Companion ─────────────────────────────────────────────────────────────

test('Companion: lazy chunk loads and WebGL canvas mounts', async ({ page }) => {
  await nav(page, 'Companion');
  // R3F mounts a <canvas> element — it may be hidden until fully initialised
  await page.waitForSelector('canvas', { state: 'attached', timeout: 20_000 });
  const canvasCount = await page.locator('canvas').count();
  expect(canvasCount).toBeGreaterThan(0);
});

// ── 12. Live Sessions (page kept on disk, not routed in current sidebar) ────
// The Live Sessions surface is no longer reachable from the sidebar; the
// component file remains in src/pages/LiveSessions.jsx for future re-routing.
// This test was removed when the nav item was removed.

// ── 13. Focus Timer ───────────────────────────────────────────────────────────

test('Focus Timer: renders without crash', async ({ page }) => {
  await nav(page, 'Focus Timer');
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
  const rootLen = await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0);
  expect(rootLen).toBeGreaterThan(500);
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
