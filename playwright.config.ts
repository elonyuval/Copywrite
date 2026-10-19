import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    locale: 'he-IL',
    trace: 'retain-on-failure',
    // Use a locally installed Chromium if provided (CI images often pre-install one).
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'bash tests/e2e/start-test-server.sh',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
