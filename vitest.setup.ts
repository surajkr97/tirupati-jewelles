/**
 * Test environment.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.4).
 *
 * lib/env.ts throws at import time on missing config, so the suite needs a complete,
 * obviously-fake environment before any module under test is loaded. These values never
 * reach a real service.
 */
const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough-32',
  OTP_PEPPER: 'test-otp-pepper-that-is-long-enough-32-byte',
  SMS_PROVIDER_KEY: 'test-sms-key',
  SMTP_URL: 'smtp://test:test@127.0.0.1:1025',
  UPLOAD_PROVIDER_KEY: 'test-upload-key',
  ALLOWED_IMAGE_HOSTS: 'res.cloudinary.com,utfs.io',
  SEED_ADMIN_EMAIL: 'admin@example.com',
  SEED_ADMIN_PASSWORD: 'test-admin-password',
  NEXT_PUBLIC_OWNER_WA: '919876543210',
  NEXT_PUBLIC_TICKER_JITTER: 'true',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] ??= value;
}
