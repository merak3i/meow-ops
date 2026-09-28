import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';

test('service worker does not persist no-store data from the local helper', async ({ page }) => {
  test.setTimeout(60_000);
  const helper = createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'x-meow-ops-local');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end('{"fixture":"private local session"}');
  });
  await new Promise<void>((resolve) => helper.listen(0, '127.0.0.1', resolve));
  const address = helper.address();
  if (!address || typeof address === 'string') throw new Error('Local helper fixture did not bind a TCP port.');
  const helperUrl = `http://127.0.0.1:${address.port}/session-history/sessions?fixture=${Date.now()}`;

  try {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    const response = await page.evaluate(async (url) => {
      const result = await fetch(url, { headers: { 'x-meow-ops-local': '1' } });
      return { status: result.status, body: await result.json() };
    }, helperUrl);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ fixture: 'private local session' });

    const cached = await page.evaluate(async (url) => {
      const names = await caches.keys();
      const matches = await Promise.all(names.map(async (name) => (await caches.open(name)).match(url)));
      return matches.some(Boolean);
    }, helperUrl);
    expect(cached).toBe(false);

    const appUrl = await page.evaluate(() => `${location.origin}/index.html?no-store-fixture=${Date.now()}`);
    const appStatus = await page.evaluate(async (url) => (await fetch(url, { cache: 'no-store' })).status, appUrl);
    expect(appStatus).toBe(200);
    const appResponseCached = await page.evaluate(async (url) => {
      const names = await caches.keys();
      const matches = await Promise.all(names.map(async (name) => (await caches.open(name)).match(url)));
      return matches.some(Boolean);
    }, appUrl);
    expect(appResponseCached).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) => helper.close((error) => error ? reject(error) : resolve()));
  }
});
