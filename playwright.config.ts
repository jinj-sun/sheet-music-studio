import { defineConfig } from '@playwright/test';
const production = process.env.E2E_PRODUCTION === '1';
const baseURL = production ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:5173';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    channel: process.env.PW_BROWSER_CHANNEL || 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: production ? 'npm run preview' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
