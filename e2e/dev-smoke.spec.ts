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
 * project, port 5175).
 */
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PRESENT = existsSync(join(ROOT, 'public', 'data', 'loop-ops', 'spec.json'));
const WORKBOOK_PRESENT = existsSync(
  '/Users/napster/Downloads/Patherle/Agentic Harness/PATHERLE_HARNESS_MASTER_SPEC_v1_2026-06-07.xlsx',
);

test('Loop Ops settles past the loading state under dev React (StrictMode liveness)', async ({ page }) => {
  await page.goto('/#/loop-ops');
  // The page must reach EITHER the loaded source strip or the instructional
  // empty state. Staying on "Loading Loop Ops…" means a mount-effect liveness
  // regression — exactly what a cleanup-only alive ref caused under
  // StrictMode's mount→cleanup→mount cycle.
  const settled = page
    .locator('[data-testid="loop-source-strip"]')
    .or(page.getByText('Import Master Spec'));
  await expect(settled.first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Loading the Loom…')).toHaveCount(0);
});

test('refresh advances the imported-mtime chip with the service worker active', async ({ page }) => {
  test.skip(!SPEC_PRESENT || !WORKBOOK_PRESENT,
    'needs the local-only spec fixture and the Master Spec workbook');
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
