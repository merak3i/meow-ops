/**
 * Dev-server smoke suite — regression coverage for dev-only failure modes
 * that the production-build suite (meow-ops.spec.ts) cannot catch:
 *
 * 1. React StrictMode runs mount→cleanup→mount in dev builds only; production
 *    React makes StrictMode a no-op. A cleanup-only liveness ref left Loop Ops
 *    stuck on "Loading…" forever — in dev only (caught 2026-06-12).
 * 2. The PWA service worker is cache-first by request URL and ignores fetch
 *    cache directives; un-busted API URLs froze the status display while the
 *    underlying data moved (caught 2026-06-12).
 *
 * Runs against the real Vite dev server (playwright.config.ts dev-smoke
 * project, port 5176).
 */
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PRESENT = existsSync(join(ROOT, 'public', 'data', 'loop-ops', 'spec.json'));
const WORKBOOK_PRESENT = Boolean(process.env.LOOP_OPS_SPEC) && existsSync(process.env.LOOP_OPS_SPEC);

test('dev-only API blocks sibling loopback origins', async ({ request }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string') throw new Error('Dev-smoke baseURL is required.');
  const origin = new URL(baseURL).origin;
  const endpoint = new URL('/api/loop-ops/status', origin).toString();

  const sameOrigin = await request.get(endpoint, { headers: { Origin: origin } });
  expect(sameOrigin.status()).toBe(200);

  const siblingPort = new URL('http://localhost:65530');
  if (siblingPort.port === new URL(origin).port) siblingPort.port = '65529';
  const siblingOrigin = await request.get(endpoint, { headers: { Origin: siblingPort.origin } });
  expect(siblingOrigin.status()).toBe(403);

  const siblingHost = await request.get(endpoint, {
    headers: { Host: 'localhost:65530', Origin: origin },
  });
  expect(siblingHost.status()).toBe(403);
});

test('Sanctum local 3D study preview loads each selected session model', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const now = Date.now();
  const roles = [
    { id: 'builder', catType: 'builder', label: 'RIVETWREN' },
    { id: 'detective', catType: 'detective', label: 'GLOAMWHISKER' },
    { id: 'commander', catType: 'commander', label: 'SKIRLBELL' },
    { id: 'architect', catType: 'architect', label: 'GRIDWHISK' },
    { id: 'guardian', catType: 'guardian', label: 'SHIELDHEART' },
    { id: 'storyteller', catType: 'storyteller', label: 'FOLIOSONG' },
    { id: 'ghost', catType: 'ghost', label: 'LANTERNMOTE' },
  ];
  const expectedModelPaths = [
    '/design/sanctum/blender/gloamwhisker-rig-v6.glb',
    '/design/sanctum/blender/skirlbell-rig-v1.glb',
    '/design/sanctum/blender/foliosong-rig-v3.glb',
    '/design/sanctum/blender/lanternmote-rig-v2.glb',
    '/design/sanctum/blender/rivetwren-rig-v10.glb',
    '/design/sanctum/blender/shieldheart-rig-v3.glb',
    '/design/sanctum/blender/gridwhisk-rig-v11.glb',
  ];
  test.skip(
    !expectedModelPaths.every(modelPath => existsSync(join(ROOT, 'public', modelPath.slice(1)))),
    'requires local-only 3D study assets excluded from public checkouts and deployments',
  );
  const expectedModelPathSet = new Set(expectedModelPaths);
  const sessions = roles.map(({ id, catType }, index) => ({
    session_id: `sanctum-3d-${id}`,
    project: 'sanctum-3d-preview-e2e',
    model: 'claude-sonnet-4-6',
    entrypoint: 'test',
    git_branch: `preview/${id}`,
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
    agent_slug: `roster-${id}`,
    session_title: `3D study ${id}`,
    tools: {},
  }));
  const loadedModels = new Set<string>();
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (expectedModelPathSet.has(path)) loadedModels.add(path);
  });
  await page.route('**/data/sessions.json*', route => route.fulfill({ json: sessions }));
  await page.goto('/?roster=3d#/sanctum');
  const roster = page.locator('.sanctum-roster button');
  await expect(roster).toHaveCount(7, { timeout: 20_000 });

  for (const role of roles) {
    await roster.filter({ hasText: role.label }).click();
    await expect(page.getByTestId('sanctum-roster-model-loaded'))
      .toHaveText(`${role.label} · 3D study`, { timeout: 30_000 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: testInfo.outputPath(`${role.id}-3d-study-preview.png`) });
    if (role.id === 'builder') {
      await page.waitForTimeout(800);
      await page.screenshot({ path: testInfo.outputPath('rivetwren-v10-preview.png') });
      await page.locator('canvas').first().hover();
      await page.mouse.wheel(0, -1_000);
      await page.waitForTimeout(700);
      await page.screenshot({ path: testInfo.outputPath('rivetwren-v10-close-preview.png') });
      await page.goto('/?roster=3d#/sanctum');
      await expect(roster).toHaveCount(7, { timeout: 20_000 });
    }
    if (role.id === 'detective') {
      await page.screenshot({ path: testInfo.outputPath('gloamwhisker-fur-v6-preview.png') });
    }
  }
  expect([...loadedModels].sort()).toEqual([...expectedModelPaths].sort());

  // The selected 3D study must follow its own session when moved, while its
  // inspector remains bound to that same session.
  const inspector = page.locator('[data-testid="sanctum-session-inspector"]');
  await expect(inspector.getByText(/LANTERNMOTE/)).toBeVisible();
  const minimap = page.locator('canvas.sanctum-hud-round');
  const selectedMarker = async () => minimap.evaluate((element) => {
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
  await page.waitForTimeout(350);
  const beforeMove = await selectedMarker();
  expect(beforeMove.count).toBeGreaterThanOrEqual(8);
  await page.keyboard.down('w');
  await page.waitForTimeout(1_200);
  await page.keyboard.up('w');
  await expect.poll(async () => {
    const afterMove = await selectedMarker();
    return Math.hypot(afterMove.x - beforeMove.x, afterMove.y - beforeMove.y);
  }, { timeout: 5_000 }).toBeGreaterThan(2);
  await expect(inspector.getByText(/LANTERNMOTE/)).toBeVisible();
  await expect(page.getByTestId('sanctum-roster-model-loaded'))
    .toHaveText('LANTERNMOTE · 3D study');
});

test('Loop Ops settles past the loading state under dev React (StrictMode liveness)', async ({ page }) => {
  await page.goto('/#/loop-ops');
  // The page must reach EITHER the loaded source strip or the instructional
  // empty state. Staying on "Loading the map…" means a mount-effect liveness
  // regression — exactly what a cleanup-only alive ref caused under
  // StrictMode's mount→cleanup→mount cycle.
  const settled = page
    .locator('[data-testid="loop-source-strip"]')
    .or(page.getByText('No loop map imported yet', { exact: true }));
  await expect(settled.first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Loading the map…')).toHaveCount(0);
});

test('refresh advances the imported-mtime chip with the service worker active', async ({ page }) => {
  test.skip(!SPEC_PRESENT || !WORKBOOK_PRESENT,
    'needs the local-only spec fixture and a Loop Ops workbook');
  test.setTimeout(90_000);

  // First load installs the service worker; the reload hands it control of
  // all fetches — the state in which un-busted API URLs serve stale cache.
  await page.goto('/#/loop-ops');
  await expect(page.locator('[data-testid="loop-source-strip"]')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => navigator.serviceWorker?.ready.then(() => undefined));
  await page.reload();
  const strip = page.locator('[data-testid="loop-source-strip"]');
  await expect(strip).toBeVisible({ timeout: 15_000 });

  const mtimeChip = () => strip.locator('text=/imported /').textContent();
  await expect(strip.locator('text=/imported /')).toBeVisible({ timeout: 15_000 });
  const before = await mtimeChip();

  await page.getByRole('button', { name: 'Refresh spec' }).click();
  // The importer takes seconds; poll the chip rather than fixed-sleeping.
  await expect(async () => {
    expect(await mtimeChip()).not.toBe(before);
  }).toPass({ timeout: 60_000, intervals: [2_000] });
});

test('Sanctum renders the originalized v2 roster with session-bound selections', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const now = Date.now();
  const roles = [
    { id: 'detective', catType: 'detective', label: 'Gloamwhisker', asset: 'gloamwhisker-realistic-cutout-v2.webp' },
    { id: 'builder', catType: 'builder', label: 'Rivetwren', asset: 'rivetwren-realistic-cutout-v2.webp' },
    { id: 'architect', catType: 'architect', label: 'Gridwhisk', asset: 'gridwhisk-realistic-cutout-v2.webp' },
    { id: 'commander', catType: 'commander', label: 'Skirlbell', asset: 'skirlbell-realistic-cutout-v2.webp' },
    { id: 'guardian', catType: 'guardian', label: 'Shieldheart', asset: 'shieldheart-realistic-cutout-v2.webp' },
    { id: 'storyteller', catType: 'storyteller', label: 'Foliosong', asset: 'foliosong-realistic-cutout-v2.webp' },
    { id: 'ghost', catType: 'ghost', label: 'Lanternmote', asset: 'lanternmote-realistic-cutout-v2.webp' },
  ] as const;
  const duplicateBuilder = {
    id: 'builder-copy',
    catType: 'builder',
    label: 'Rivetwren copy',
    asset: 'rivetwren-realistic-cutout-v2.webp',
  } as const;
  const previewRoles = [...roles, duplicateBuilder];
  const sessions = previewRoles.map(({ id, catType, label }, index) => ({
    session_id: `sanctum-roster-${id}`,
    project: 'sanctum-roster-e2e',
    model: 'claude-sonnet-4-6',
    entrypoint: 'test',
    git_branch: `preview/${id}`,
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
    agent_slug: `sanctum-roster-${id}`,
    session_title: `Synthetic ${label} archive session`,
    tools: {},
  }));
  const artRequests: string[] = [];
  const artResponses: { path: string; status: number }[] = [];
  const pageErrors: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/src/pages/sanctum/assets/roster/') && path.endsWith('-realistic-cutout-v2.webp')) {
      artRequests.push(path);
    }
  });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/src/pages/sanctum/assets/roster/') && path.endsWith('-realistic-cutout-v2.webp')) {
      artResponses.push({ path, status: response.status() });
    }
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/loop-eng/eternal-stats', route => route.abort());
  await page.route('**/data/sessions.json*', route => route.fulfill({ json: sessions }));
  await page.goto('/#/sanctum');
  await expect(page.getByText('Sanctum session archive', { exact: true })).toBeVisible({ timeout: 20_000 });

  const roster = page.locator('.sanctum-roster button');
  const inspector = page.locator('[data-testid="sanctum-session-inspector"]');
  await expect(roster).toHaveCount(8, { timeout: 20_000 });
  const expectedAssetPaths = roles
    .map(({ asset }) => `/src/pages/sanctum/assets/roster/${asset}`)
    .sort();
  await expect.poll(() => [...artRequests].sort()).toEqual(expectedAssetPaths);
  await expect.poll(() => artResponses.map(({ path }) => path).sort()).toEqual(expectedAssetPaths);
  expect(artResponses.every(({ status }) => status === 200)).toBe(true);
  await expect(page.getByTestId('sanctum-roster-character-loaded')).toHaveCount(8, { timeout: 20_000 });
  await page.screenshot({ path: testInfo.outputPath('full-originalized-roster-v2-art-preview.png') });
  await page.locator('canvas').first().hover();
  await page.mouse.wheel(0, -850);

  for (const role of roles) {
    await page.locator(`.sanctum-roster button[title^="Synthetic ${role.label} archive session"]`).click();
    await expect(inspector).toContainText(role.catType.toUpperCase());
    const artTag = page.locator(`[data-testid="sanctum-roster-character-loaded"][data-session-selected="true"][data-roster-role="${role.catType}"]`);
    await expect(artTag).toHaveCount(1, { timeout: 20_000 });
    await expect(artTag).toHaveText(/^#[0-9A-F]{4}$/i);
    await page.screenshot({ path: testInfo.outputPath(`${role.id}-originalized-v2-character.png`) });
    if (role.id === 'builder') {
      await expect(artTag).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('rivetwren-originalized-v2-character.png') });
    }
  }

  await expect(page.getByTestId('sanctum-roster-character-loaded')).toHaveCount(8);
  expect(pageErrors).toEqual([]);
});
