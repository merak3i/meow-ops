import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,        // sequential — single Vite preview instance
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,             // generous per-test: lazy chunks can take time
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    headless: true,
    // Wait for network idle before assertions
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  // Serve the already-built dist — no dep optimisation reloads
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
