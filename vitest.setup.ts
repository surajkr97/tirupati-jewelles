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
  UPLOAD_PROVIDER_KEY: 'test-upload-key',
  ALLOWED_IMAGE_HOSTS: 'res.cloudinary.com,utfs.io',
  SEED_ADMIN_EMAIL: 'admin@example.com',
  SEED_ADMIN_PASSWORD: 'test-admin-password',
  NEXT_PUBLIC_OWNER_WA: '919876543210',
  NEXT_PUBLIC_TICKER_JITTER: 'true',
};

// The DB URL must be the test one even if .env already set a development value.
process.env.DATABASE_URL = TEST_ENV.DATABASE_URL;

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] ??= value;
}

/** True when a real test database is configured. DB suites gate on this. */
export const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
