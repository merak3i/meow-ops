import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,        // sequential — single Vite preview instance
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,             // generous per-test: lazy chunks can take time
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    trace: 'on-first-retry',
    headless: true,
    // Wait for network idle before assertions
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  webServer: [
    // Serve the already-built dist — no dep optimisation reloads
    {
      command: 'npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    // Real Vite dev server for the dev-smoke project: dev-only failure modes
    // (StrictMode double-effects, service-worker module caching) are invisible
    // to the production-React preview build by construction.
    {
      command: 'npm run dev -- --port 5175 --strictPort',
      url: 'http://localhost:5175',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],

  projects: [
    {
      name: 'chromium',
      testMatch: /meow-ops\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
    {
      name: 'dev-smoke',
      testMatch: /dev-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5175' },
    },
  ],
});
