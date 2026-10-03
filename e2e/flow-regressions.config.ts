import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'flow-regressions.spec.ts',
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5189', serviceWorkers: 'block' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5189 --strictPort',
    url: 'http://127.0.0.1:5189',
    cwd: '..',
    env: { VITE_ACCESS_PASSWORD: '', MEOW_CONFIG_FILE: '' },
    reuseExistingServer: false,
  },
});
