import { expect, test, type Page } from '@playwright/test';
import type { StorageSnapshot } from '../src/lib/storage-api';

test.use({ serviceWorkers: 'block' });
const counts = { fileCount: 1, logicalBytes: 2048, allocatedBytes: 4096, allocatedFileCount: 1 };
const empty = { fileCount: 0, logicalBytes: 0, allocatedBytes: 0, allocatedFileCount: 0 };
const growth = { status: 'unavailable' as const, logicalBytes: null, allocatedBytes: null, fileCount: null };
const fixture: StorageSnapshot = {
  schemaVersion: 1, scope: 'local-metadata-only', generatedAt: '2026-10-03T08:00:00Z', previousGeneratedAt: null,
  measurement: 'Filesystem metadata', totals: counts, growth,
  coverage: { status: 'partial', registeredRoots: 2, completeRoots: 1, missingRoots: 1, partialRoots: 0, errorCount: 0, errorsTruncated: false },
  categories: [{ category: 'logs', ...counts }], modelBuckets: [{ kind: 'unknown', models: [], ...counts }],
  unresolvedLocations: [{ source: 'deepseek', status: 'detected-unresolved', reason: 'Tool detected; log location has not been confirmed.' }],
  roots: [
    { id: 'codex-sessions', source: 'codex', path: '/private-fixture/codex/sessions', category: 'logs', status: 'complete', ...counts, oldestModifiedAt: null, newestModifiedAt: null, errorCount: 0, categories: [], modelBuckets: [{ kind: 'single', models: ['gpt-fixture'], ...counts }], growth },
    { id: 'claude-sessions', source: 'claude', path: '/private-fixture/claude/projects', category: 'logs', status: 'missing', ...empty, oldestModifiedAt: null, newestModifiedAt: null, errorCount: 0, categories: [], modelBuckets: [], growth },
  ], errors: [],
};

async function mockHelper(page: Page, storage: (path: string, body: unknown) => unknown) {
  await page.route(/^http:\/\/(?:127\.0\.0\.1|localhost):7337\//, route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/storage')) return route.fulfill({ json: storage(path, request.method() === 'POST' ? request.postDataJSON() : null) });
    if (path === '/sync/status') return route.fulfill({ json: { ok: true, state: 'succeeded' } });
    return route.abort();
  });
}

test('Storage displays measured bytes, missing locations and honest model attribution', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockHelper(page, () => ({ ok: true, snapshot: fixture, refreshing: false }));
  await page.goto('/#/today/storage');
  await expect(page.getByRole('tab', { name: 'Storage', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Partial registered coverage', { exact: false })).toBeVisible();
  await expect(page.getByText('Unknown model', { exact: true })).toBeVisible();
  await expect(page.getByText('Detected tools with unconfirmed locations', { exact: true })).toBeVisible();
  const missing = page.getByRole('row').filter({ hasText: 'Claude Sessions' });
  await expect(missing.getByText('Unavailable', { exact: true })).toHaveCount(2);
  await expect(missing.getByRole('button', { name: 'Open folder', exact: true })).toBeDisabled();
  const codex = page.getByRole('row').filter({ hasText: 'Codex Sessions' });
  await codex.getByText('Models and attribution (1)', { exact: true }).click();
  await expect(codex).toContainText('gpt-fixture');
  await expect(codex).toContainText('2 KiB');
  await expect(page.getByText(/APFS can share extents/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('storage-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('Storage first measurement polls a background scan and does not invent a baseline', async ({ page }) => {
  let refreshed = false;
  await mockHelper(page, path => {
    if (path === '/storage/refresh') { refreshed = true; return { ok: true, snapshot: null, refreshing: true }; }
    return { ok: true, snapshot: refreshed ? fixture : null, refreshing: false };
  });
  await page.goto('/#/today/storage');
  await expect(page.getByText(/No measurement yet/)).toBeVisible();
  await expect(page.getByText('Observed logical size', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Measure storage', exact: true }).click();
  await expect(page.getByText('Observed logical size', { exact: true })).toBeVisible();
  await expect(page.getByText('A comparable second measurement is needed.', { exact: true })).toBeVisible();
  expect(refreshed).toBe(true);
});

test('Storage copies the exact displayed path but sends only a root ID to open its folder', async ({ page }) => {
  const opened: unknown[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => { Reflect.set(window, 'storageCopiedPath', value); } } });
  });
  await mockHelper(page, (path, body) => {
    if (path === '/storage/open-folder') { opened.push(body); return { ok: true }; }
    return { ok: true, snapshot: fixture, refreshing: false };
  });
  await page.goto('/#/today/storage');
  const row = page.getByRole('row').filter({ hasText: 'Codex Sessions' });
  await expect(row.getByRole('textbox')).toHaveValue('/private-fixture/codex/sessions');
  await row.getByRole('button', { name: 'Copy path', exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, 'storageCopiedPath'))).toBe('/private-fixture/codex/sessions');
  await row.getByRole('button', { name: 'Open folder', exact: true }).click();
  await expect(page.getByText('Opened the folder for Codex Sessions.', { exact: true })).toBeVisible();
  expect(opened).toEqual([{ rootId: 'codex-sessions' }]);
});

test('Storage keeps its wide path table inside a scroll region on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockHelper(page, () => ({ ok: true, snapshot: fixture, refreshing: false }));
  await page.goto('/#/today/storage');
  await expect(page.getByText('Observed logical size', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const table = page.getByRole('region', { name: 'Storage by registered location' });
  expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('storage-mobile.png'), fullPage: true });
});

test('Storage rejects malformed measurements and offers a retry', async ({ page }) => {
  await mockHelper(page, () => ({ ok: true, snapshot: { ...fixture, totals: { ...counts, logicalBytes: 'wrong' } } }));
  await page.goto('/#/today/storage');
  await expect(page.getByText(/Storage measurements could not be verified/)).toBeVisible();
  await expect(page.getByText('Observed logical size', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Measure storage', exact: true })).toBeEnabled();
});
