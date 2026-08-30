// Headless screenshot capture for README.
// Usage: node scripts/capture-screenshots.mjs
// Assumes Vite is already running on :5173.

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { join } from 'path';

const URL = process.env.MEOW_OPS_URL || 'http://localhost:5173';
const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots');

await mkdir(OUT, { recursive: true });

const SHOTS = [
  { hash: '#/today/summary', file: '01-overview.png', wait: 2500, openTimer: true },
  { hash: '#/ledger', file: '02-cost-tracker.png', wait: 2500 },
  { hash: '#/sanctum', file: '03-colony.png', wait: 5000 },
  { hash: '#/review/inbox', file: '04-live-sessions.png', wait: 2500 },
  { hash: '#/today/summary', file: '05-focus-timer.png', wait: 2000, openTimer: true },
  { hash: '#/learn', file: '06-by-project.png', wait: 2500 },
  { hash: '#/review/projects', file: '07-by-day.png', wait: 2500 },
  { hash: '#/today/runs', file: '08-by-action.png', wait: 3000 },
  { hash: '#/today/sessions', file: '09-sessions.png', wait: 2500 },
];

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

async function closeTimer() {
  await page.locator('.mo-focus__pop').evaluateAll((nodes) => {
    for (const el of nodes) el.remove();
  }).catch(() => {});
}

async function settle() {
  await page.locator('main').evaluate((main) => {
    main.querySelectorAll('*').forEach((el) => {
      if (el.style && el.style.opacity === '0') el.style.opacity = '1';
    });
  }).catch(() => {});
}

for (const shot of SHOTS) {
  await page.goto(`${URL}/${shot.hash}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(shot.wait);
  await closeTimer();
  if (shot.openTimer) {
    const timeBtn = page.locator('.mo-focus__time');
    if (await timeBtn.count()) await timeBtn.click();
    await page.waitForTimeout(400);
  }
  await settle();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, shot.file), fullPage: false });
  console.log(`captured ${shot.hash} -> ${shot.file}`);
}

await browser.close();
console.log(`saved to ${OUT}`);
