import { defineConfig } from 'playwright/test';

/**
 * END-TO-END CONFIGURATION (Phase 10)
 *
 * These tests drive a real browser against the real API and a real PostgreSQL
 * database. Nothing is mocked, which is why they are slow and why they are the only
 * evidence that matters before go-live.
 *
 * Prerequisites (see documentation/RUNBOOK.md):
 *   bash scripts/dev-env-up.sh
 *   npm run build:shared && npm run db:migrate && npm run db:seed
 *   node scripts/seed-demo-phase4.mjs
 *   API on :4000 and web on :5173
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
    // A failing run leaves a trace you can open with `npx playwright show-trace`.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
  },
});
