// Headless screenshot capture for README.
// Run with `npx playwright` already installed.
// Usage: node scripts/capture-screenshots.mjs
//
// Spins up the dev server context (assumes it's already running on :5176),
// loads each page, forces animations to complete, captures a 1440x900 PNG.

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { join } from 'path';

const URL = process.env.MEOW_OPS_URL || 'http://localhost:5176';
const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots');

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2, // retina-quality screenshots
});
const page = await ctx.newPage();

async function loadAndCapture(navIndex, label, filename, opts = {}) {
  // Navigate to the page
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Click the nav button
  if (navIndex > 0) {
    await page.evaluate((i) => {
      document.querySelectorAll('aside nav button')[i]?.click();
    }, navIndex);
    await page.waitForTimeout(opts.wait || 1500);
  } else {
    await page.waitForTimeout(opts.wait || 2000);
  }

  // Force all framer-motion + Recharts animations to their final state
  await page.evaluate(() => {
    // Cards: opacity 0 → 1, translateY → none
    document.querySelectorAll('main *').forEach((el) => {
      if (el.style && el.style.opacity === '0') el.style.opacity = '1';
      if (el.style && el.style.transform && el.style.transform.includes('translate')) {
        el.style.transform = 'none';
      }
    });
    // Recharts paths: clear strokeDasharray that animates "draw-on" effect
    document.querySelectorAll('path').forEach((p) => {
      try {
        p.style.strokeDasharray = 'none';
        p.style.strokeDashoffset = '0';
        p.removeAttribute('stroke-dasharray');
        p.removeAttribute('stroke-dashoffset');
        if (p.getAttribute('opacity') === '0') p.setAttribute('opacity', '1');
      } catch {}
    });
    document.querySelectorAll('rect, circle, ellipse').forEach((el) => {
      try {
        if (el.getAttribute('opacity') === '0') el.setAttribute('opacity', '1');
      } catch {}
    });
  });

  // Optional callback for page-specific tweaks
  if (opts.tweak) await opts.tweak(page);

  await page.waitForTimeout(500);

  const out = join(OUT, filename);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`✓ ${label} → ${out}`);
}

// 0=Overview, 1=Sessions, 2=By Project, 3=By Day, 4=By Action, 5=Cost Tracker,
// 6=Colony, 7=Live Sessions, 8=Focus Timer
await loadAndCapture(0, 'Overview',     '01-overview.png');
await loadAndCapture(5, 'Cost Tracker', '02-cost-tracker.png');
await loadAndCapture(6, 'Cat Colony',   '03-colony.png');
await loadAndCapture(7, 'Live Sessions','04-live-sessions.png');
await loadAndCapture(8, 'Focus Timer',  '05-focus-timer.png', {
  // Click "models" tab when relevant — but Focus Timer doesn't need it
});
await loadAndCapture(2, 'By Project',   '06-by-project.png');
await loadAndCapture(3, 'By Day',       '07-by-day.png');
await loadAndCapture(4, 'By Action',    '08-by-action.png');
await loadAndCapture(1, 'Sessions',     '09-sessions.png');

await browser.close();
console.log('\n✨ All screenshots saved to docs/screenshots/');
