/**
 * Playwright configuration.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.4).
 *
 * The 375px project is the important one: MASTER-SPEC §1 puts 95% of traffic on phones,
 * and every phase's DESIGN checklist audits 375px first. 768/1280 exist so Phase 2 can
 * assert no horizontal scroll at any width.
 */
import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

/**
 * Load `.env` into the test process.
 *
 * Playwright does not do this itself — only the `webServer` it spawns inherits the shell's
 * environment. The Phase 7 admin suite needs `SEED_ADMIN_*` to sign in, and without this it
 * skipped fourteen tests silently, which is the worst way for a suite to be absent.
 */
loadEnv({ path: '.env', quiet: true });

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

/**
 * A second dev server with the ticker jitter switched off.
 *
 * `NEXT_PUBLIC_*` is inlined at compile time, so the off-switch cannot be flipped from a
 * test — it needs a server built with the flag false. Phase 4 §4 TEST asks for exactly
 * this ("`NEXT_PUBLIC_TICKER_JITTER=false` → value stays constant across 10s") and
 * MASTER-SPEC §8 treats the off-switch as the legal insurance for showing an indicative
 * price, so it is worth a real browser rather than a mocked module.
 *
 * It gets its own `distDir`: two `next dev` processes writing one `.next` corrupt each
 * other's output, which shows up as random chunk 404s rather than an obvious clash.
 */
const JITTER_OFF_PORT = 3001;
export const JITTER_OFF_URL = `http://localhost:${JITTER_OFF_PORT}`;

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
    /**
     * Signs in once and writes a cookie jar the admin suite reuses. Without it, four
     * workers authenticating per test trip the Phase 3 login limiter — see e2e/admin.setup.ts.
     */
    { name: 'setup', testMatch: /admin\.setup\.ts/ },
    {
      name: 'mobile-375',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
      dependencies: ['setup'],
    },
    {
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
      dependencies: ['setup'],
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      dependencies: ['setup'],
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
  webServer: [
    {
      command: 'pnpm dev',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: `pnpm dev --port ${JITTER_OFF_PORT}`,
      url: JITTER_OFF_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_TICKER_JITTER: 'false',
        NEXT_DIST_DIR: '.next-jitter-off',
      },
    },
  ],
});
