import { defineConfig, devices } from '@playwright/test';

function configuredPort(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer TCP port from 1 to 65535.`);
  }
  return String(port);
}

const previewPort = configuredPort('MEOW_OPS_E2E_PREVIEW_PORT', '4275');
const devPort = configuredPort('MEOW_OPS_E2E_DEV_PORT', '5176');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,                  // Keep the WebGL page and dev server from competing for browser/GPU time.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,             // generous per-test: lazy chunks can take time
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    trace: 'on-first-retry',
    headless: process.env.SANCTUM_PERF_HEADFUL !== '1',
    // Wait for network idle before assertions
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  webServer: [
    // Serve the already-built dist — no dep optimisation reloads
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${previewPort} --strictPort`,
      url: `http://127.0.0.1:${previewPort}`,
      // Do not mistake a stale preview from another checkout for this build.
      reuseExistingServer: false,
      timeout: 60_000,
    },
    // Real Vite dev server for the dev-smoke project: dev-only failure modes
    // (StrictMode double-effects, service-worker module caching) are invisible
    // to the production-React preview build by construction.
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${devPort} --strictPort`,
      url: `http://127.0.0.1:${devPort}`,
      // Fail on occupied ports instead of silently testing another checkout.
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],

  projects: [
    {
      name: 'chromium',
      testMatch: /meow-ops\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${previewPort}` },
    },
    {
      name: 'dev-smoke',
      testMatch: /dev-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${devPort}` },
    },
    {
      name: 'service-worker',
      testMatch: /service-worker-privacy\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${previewPort}` },
    },
  ],
});
