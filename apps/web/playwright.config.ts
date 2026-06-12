import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Full-stack auth suite needs a live API + Postgres; it has its own
  // config/runner (playwright.auth.config.ts, `pnpm test:e2e:auth`).
  testIgnore: '**/auth/**',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Serves the built dist/ directory; build the app before running e2e
    command: 'pnpm --filter @silo/web preview',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
