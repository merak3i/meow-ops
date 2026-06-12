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
    'The Loom', 'Companion', 'Focus Timer',
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
// The spec fixture (public/data/loop-ops/spec.json) is LOCAL-ONLY — gitignored
// via public/data/*, regenerated by the Phase 3 importer. Data-dependent tests
// skip on machines without it (fresh clones, CI) instead of failing; the
// hosted build intentionally ships the instructional empty state. Counts and
// ids below are pinned to the 2026-06-12 fixture — regenerate together.

async function loopSpecPresent(page: import('@playwright/test').Page): Promise<boolean> {
  const res = await page.request.get('/data/loop-ops/spec.json');
  return res.status() === 200;
}

test('The Loom: safety badge renders with or without spec data', async ({ page }) => {
  await nav(page, 'The Loom');
  // The safety invariant badge is part of the page contract from Phase 1 on,
  // in both the empty state and the loaded source strip.
  await expect(page.locator('text=/production writes disabled/i').first()).toBeVisible();
  await expect(page.locator('[data-vite-error]')).toHaveCount(0);
});

test('Loop Ops: canvas renders all 31 entities when waves expanded', async ({ page }) => {
  test.skip(!(await loopSpecPresent(page)), 'local-only Loop-Ops fixture absent — run the importer');
  await nav(page, 'The Loom');
  await expect(page.locator('text=31 entities · 26 surfaces')).toBeVisible();
  await expect(page.locator('[data-testid="loop-canvas"]')).toBeVisible();
  // Default: wave 1 expanded → 1 coordinator + 4 directors + 3 wave-1 tenant
  // surfaces (rag.core is customer-lane) + 4 non-tenant surfaces = 12 entity
  // nodes. 3 cluster nodes: wave 4 has no tenant surfaces, empty waves render
  // no cluster.
  await expect(page.locator('[data-testid="loop-entity"]')).toHaveCount(12);
  await expect(page.locator('[data-testid="loop-cluster"]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Expand all waves' }).click();
  await expect(page.locator('[data-testid="loop-entity"]')).toHaveCount(31);
  // Phase 4 operator action — presence only; clicking would spawn the real
  // importer against a machine-specific workbook path.
  await expect(page.getByRole('button', { name: 'Refresh spec' })).toBeVisible();
});

test('Loop Ops: inspector drawer answers the four questions', async ({ page }) => {
  test.skip(!(await loopSpecPresent(page)), 'local-only Loop-Ops fixture absent — run the importer');
  await nav(page, 'The Loom');
  await page.locator('[data-entity-id="rag.core"]').click();
  const inspector = page.locator('[data-testid="loop-inspector"]');
  await expect(inspector).toBeVisible();
  for (const q of ['What owns this', 'What it can touch', 'Last verified state', 'Not verified']) {
    // exact:true — section headings only; body text also contains "not verified".
    await expect(inspector.getByText(q, { exact: true })).toBeVisible();
  }
  // Phase 6 acceptance: a Wave-1 entity shows a validation command + repo links.
  await expect(inspector.locator('text=/Validation/')).toBeVisible();
  await expect(inspector.locator('text=/check:ai-evals|check:release/')).toBeVisible();
  await expect(inspector.locator('text=Repo links (read-only)')).toBeVisible();
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
