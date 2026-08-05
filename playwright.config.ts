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

/**
 * `localhost`, not `127.0.0.1`.
 *
 * Next 16's dev server enforces an allowed-origin check on dev resources and answers
 * 403 for chunks requested from a host it does not recognise. Hitting 127.0.0.1 therefore
 * serves the SSR HTML fine but blocks every JS chunk, so React never hydrates — which
 * shows up as "static assertions pass, every interactive test fails", not as an obvious
 * network error. Use the hostname Next expects instead of adding `allowedDevOrigins`,
 * which would loosen a dev-server security check to work around a test-harness detail.
 */
const BASE_URL = `http://localhost:${PORT}`;

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

  /**
   * Runs against the DEV server, not a production build.
   *
   * The /__design gallery is dev-only by design (§2.5) — under `pnpm start` it correctly
   * 404s, so the component audit could not run at all here. The production-only behaviour
   * that genuinely needs checking is that 404 itself, which
   * `scripts/verify-production-guard.sh` asserts against a real production server.
   */
  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
