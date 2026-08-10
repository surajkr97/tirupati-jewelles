/**
 * Test environment.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.4), extended by Phase 3.
 *
 * lib/env.ts throws at import time on missing config, so the suite needs a complete,
 * obviously-fake environment before any module under test is loaded.
 *
 * Integration tests point at a REAL Postgres (`tirupati_test`) rather than a mock: the
 * things Phase 3 must prove — atomic OTP consumption, transactional order claims, unique
 * constraints — are database behaviours, and a mock would assert only that the mock works.
 * `TEST_DATABASE_URL` selects it; without one, DB-backed suites skip rather than silently
 * writing to a development database.
 */
import { config } from 'dotenv';

config({ path: '.env', quiet: true });

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:5432/test',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough-32',
  OTP_PEPPER: 'test-otp-pepper-that-is-long-enough-32-byte',
  EMAIL_FROM: 'Tirupati Jewelles <test@example.com>',
  // Cloudinary (Phase 7 §7.8). Obviously fake — the signing tests assert the algorithm,
  // not the account, and nothing in the suite calls Cloudinary.
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: '000000000000000',
  CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
  ALLOWED_IMAGE_HOSTS: 'res.cloudinary.com,utfs.io',
  SEED_ADMIN_EMAIL: 'admin@example.com',
  SEED_ADMIN_PASSWORD: 'test-admin-password',
  NEXT_PUBLIC_OWNER_WA: '919876543210',
  NEXT_PUBLIC_TICKER_JITTER: 'true',
};

/**
 * D-054 — refuse to run the suite against a database that is not on this machine.
 *
 * The integration suites `TRUNCATE` shared tables between files. Pointed at a remote
 * database — a `TEST_DATABASE_URL` copied from somewhere for one debugging session and left
 * there — that is not a failing test, it is an emptied database.
 *
 * Checked here rather than through `lib/env.ts`'s helper because this file runs BEFORE any
 * module under test is imported, which is the whole point of it: `lib/env.ts` throws at
 * import time and the suite has to build a complete environment first.
 */
const testHost = (() => {
  try {
    return new URL(TEST_ENV.DATABASE_URL!).hostname;
  } catch {
    return 'localhost';
  }
})();

if (
  process.env.ALLOW_REMOTE_DB !== '1' &&
  !['localhost', '127.0.0.1', '::1', '[::1]', 'db', 'postgres'].includes(testHost)
) {
  throw new Error(
    `TEST_DATABASE_URL points at ${testHost}, which is not this machine.\n` +
      `The integration suites TRUNCATE tables. Refusing.\n` +
      `If you mean it: ALLOW_REMOTE_DB=1 pnpm test`,
  );
}

// The DB URL must be the test one even if .env already set a development value.
process.env.DATABASE_URL = TEST_ENV.DATABASE_URL;

/**
 * Redis, likewise — and this one bit.
 *
 * `.env` sets `REDIS_URL` for development, and the `??=` below would have kept it, so the
 * suite and the dev server shared one Redis database. The integration tests write
 * `rates:current` from the TEST database, and the running dev app then served those figures:
 * `/api/rates` reported gold 18K at ₹0 on a development machine whose Postgres had a
 * perfectly good rate in it. It surfaced as an E2E assertion failing on a total, three
 * layers away from the cause.
 *
 * Database 1, not a separate server: same container, no extra setup, and `FLUSHDB` in a test
 * can never reach development data.
 */
process.env.REDIS_URL = (
  process.env.TEST_REDIS_URL ??
  process.env.REDIS_URL ??
  ''
).replace(/\/\d+$/, '/1');
if (!process.env.REDIS_URL) process.env.REDIS_URL = 'redis://127.0.0.1:6379/1';

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] ??= value;
}

/** True when a real test database is configured. DB suites gate on this. */
export const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);

/**
 * jsdom has no `ResizeObserver`.
 *
 * Added by Phase 6 for `components/shell/sticky-bar.tsx`, which measures itself so the
 * layout can reserve exactly the right space. The component degrades gracefully without
 * the API, but stubbing it here means the tests exercise the observing path rather than
 * quietly taking the fallback — a test that skips the code it is meant to cover is worse
 * than no test.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
