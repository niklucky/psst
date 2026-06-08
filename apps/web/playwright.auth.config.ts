import { defineConfig, devices } from '@playwright/test';

/**
 * Full-stack auth E2E suite.
 *
 * Unlike tests/smoke.spec.ts (which runs against the static production build
 * with no backend attached), these tests drive real register/login/lock/unlock
 * flows against a live API server + Postgres — exactly how a user hits them.
 *
 * One-time local setup:
 *   docker compose -f ../../compose.local.yml up -d
 *   pnpm --filter @psst/db db:migrate
 *
 * Run:
 *   pnpm --filter @psst/web test:e2e:auth
 */
export default defineConfig({
  testDir: './tests/auth',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm dev',
      cwd: '../../server',
      url: 'http://localhost:3001/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
