/**
 * Playwright configuration.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.4).
 *
 * The 375px project is the important one: MASTER-SPEC §1 puts 95% of traffic on phones,
 * and every phase's DESIGN checklist audits 375px first. 768/1280 exist so Phase 2 can
 * assert no horizontal scroll at any width.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  // All three run on Chromium with explicit viewports rather than the bundled WebKit
  // device presets. The assertions are about width, not engine, and this keeps CI to a
  // single browser download (`playwright install chromium`).
  projects: [
    {
      name: 'mobile-375',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],

  webServer: {
    command: 'pnpm start',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
