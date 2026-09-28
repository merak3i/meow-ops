import { defineConfig, devices } from '@playwright/test';

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
      command: 'npm run preview -- --host 127.0.0.1 --port 4275 --strictPort',
      url: 'http://127.0.0.1:4275',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    // Real Vite dev server for the dev-smoke project: dev-only failure modes
    // (StrictMode double-effects, service-worker module caching) are invisible
    // to the production-React preview build by construction.
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5176 --strictPort',
      url: 'http://127.0.0.1:5176',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],

  projects: [
    {
      name: 'chromium',
      testMatch: /meow-ops\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4275' },
    },
    {
      name: 'dev-smoke',
      testMatch: /dev-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5176' },
    },
    {
      name: 'service-worker',
      testMatch: /service-worker-privacy\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4275' },
    },
  ],
});
