/**
 * Environment configuration — the single source of truth.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.5), schema from MASTER-SPEC §9.
 *
 * This is the ONLY file permitted to touch `process.env`. An ESLint rule
 * (`no-restricted-properties` in eslint.config.mjs) enforces that everywhere else —
 * because the moment a route handler reads process.env directly, this schema stops being
 * the source of truth and a missing variable becomes a 3am production `undefined` instead
 * of a boot-time crash.
 *
 * It throws at import time. That is deliberate: a server that cannot see its config should
 * fail to start, loudly, not serve broken pages.
 */
import { z } from 'zod';

/** Placeholder marker used throughout .env.example. Never valid in production. */
const PLACEHOLDER = 'CHANGE_ME';

const secret = (name: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 bytes — see MASTER-SPEC §9`)
    .refine(
      (v) => process.env.NODE_ENV !== 'production' || !v.includes(PLACEHOLDER),
      `${name} still holds the .env.example placeholder. Generate a real one: openssl rand -base64 32`,
    );

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  SESSION_SECRET: secret('SESSION_SECRET'),
  OTP_PEPPER: secret('OTP_PEPPER'),

  /**
   * Email delivery via Resend (HTTPS), not SMTP.
   *
   * Render blocks outbound SMTP ports (25/465/587) on most plans, so a nodemailer
   * transport would time out in production while working perfectly in development —
   * the worst kind of failure. Resend is an HTTPS API and is unaffected.
   *
   * Optional in development: with no key, OTPs are logged to the console instead of sent
   * (§3.2). `lib/notify` refuses to fall back to the console logger in production.
   */
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Tirupati Jewelles <onboarding@resend.dev>'),

  /**
   * SMS is not in use. Every OTP goes to email (D-011).
   *
   * Optional so the stack boots without a provider. When SMS is added later, this becomes
   * required and `SmsNotifier` is implemented against it.
   */
  SMS_PROVIDER_KEY: z.string().optional(),

  // Phase 7 (uploads + the SSRF-guarded image URL field).
  UPLOAD_PROVIDER_KEY: z.string().min(1),
  ALLOWED_IMAGE_HOSTS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),

  // Seeds the first ADMIN. Phase 1 §1.6: "credentials from env, not hardcoded".
  SEED_ADMIN_EMAIL: z.string().email(),
  SEED_ADMIN_PASSWORD: z.string().min(8),
});

/**
 * Client-visible config.
 *
 * These must be referenced as literal `process.env.NEXT_PUBLIC_*` expressions — Next
 * statically finds and inlines those strings at build time. Reading them off a dynamic
 * object would leave `undefined` in the browser bundle, which is exactly the kind of bug
 * that only shows up in production.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_OWNER_WA: z
    .string()
    .regex(/^\d{10,15}$/, 'NEXT_PUBLIC_OWNER_WA must be digits only, e.g. 919876543210'),
  NEXT_PUBLIC_TICKER_JITTER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const clientValues = {
  NEXT_PUBLIC_OWNER_WA: process.env.NEXT_PUBLIC_OWNER_WA,
  NEXT_PUBLIC_TICKER_JITTER: process.env.NEXT_PUBLIC_TICKER_JITTER,
};

function fail(scope: string, error: z.ZodError): never {
  const issues = error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(
    `Invalid ${scope} environment configuration:\n${issues}\n\n` +
      `Copy .env.example to .env and fill it in (specs/00-MASTER-SPEC.md §9).`,
  );
}

const clientParsed = clientSchema.safeParse(clientValues);
if (!clientParsed.success) fail('client', clientParsed.error);

/** Config safe to reach the browser. */
export const clientEnv = clientParsed.data;

/**
 * Server-only config. Accessing this from a client component is a bug — the getter throws
 * rather than silently handing back a half-populated object.
 */
export const env: z.infer<typeof serverSchema> = (() => {
  if (typeof window !== 'undefined') {
    return new Proxy({} as z.infer<typeof serverSchema>, {
      get(_t, prop) {
        throw new Error(
          `Attempted to read server env "${String(prop)}" in the browser. ` +
            `Use clientEnv (NEXT_PUBLIC_*) instead.`,
        );
      },
    });
  }
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) fail('server', parsed.error);
  return parsed.data;
})();
