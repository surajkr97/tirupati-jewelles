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

  /**
   * Cloudinary — direct-to-provider signed uploads (Phase 7 §7.8).
   *
   * Replaces MASTER-SPEC §9's single `UPLOAD_PROVIDER_KEY`, because Cloudinary needs three
   * values and one string cannot hold them (D-025).
   *
   * The cloud name and API key are public — both appear in delivery URLs and in every
   * signed request. The SECRET is the only one that matters: it signs upload parameters
   * server-side and must never reach the browser. It is read here and nowhere else, so
   * there is exactly one place to audit.
   *
   * Optional so the application still boots without them — §7.6's paste-a-URL path works
   * regardless, and a missing key disables the upload button rather than crashing at start.
   */
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  ALLOWED_IMAGE_HOSTS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),

  /**
   * Which WhatsApp send layer a bill uses (Phase 8 §8.4: "Swap via config").
   *
   * `deep-link` opens `wa.me` with the message prefilled and the admin taps send — free,
   * no Meta Business verification, works today. `cloud-api` is declared and deliberately
   * unimplemented (DEBT-004 puts auto-send post-launch); selecting it surfaces an error on
   * the bill screen rather than silently doing nothing.
   */
  WHATSAPP_SENDER: z.enum(['deep-link', 'cloud-api']).default('deep-link'),

  // Seeds the first ADMIN. Phase 1 §1.6: "credentials from env, not hardcoded".
  SEED_ADMIN_EMAIL: z.string().email(),
  SEED_ADMIN_PASSWORD: z.string().min(8),

  /**
   * How many proxies in front of us append to `x-forwarded-for` (Phase 9 §9.1, SEC-032).
   *
   * `clientIp()` counts back from the RIGHT of that header, because the leftmost entry is
   * whatever the caller sent and trusting it makes every per-IP rate limit decorative.
   *
   * 1 is correct both for a platform that replaces the header outright and for one that
   * appends a single hop. Raise it only after confirming the real topology — DEBT-009 —
   * and note that getting it wrong cannot collapse every visitor into one bucket:
   * `clientIpFromHeaders` refuses to treat a private or link-local address as an identity.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),

  /**
   * Sentry (Phase 9 §9.4). Optional, and its absence is a supported state.
   *
   * Without a DSN the SDK is never initialised and the application behaves exactly as it
   * did before — which is what development and CI want, and what a deploy that has not yet
   * been given a project gets. §9.4 says PII scrubbing must be configured "before launch";
   * `lib/monitoring/sentry.ts` does that unconditionally, so it cannot be forgotten in the
   * gap between adding the DSN and remembering the scrubber.
   */
  SENTRY_DSN: z.string().url().optional(),
  /** `production` / `staging`. Defaults to NODE_ENV so a staging error is distinguishable. */
  SENTRY_ENVIRONMENT: z.string().optional(),
  /**
   * Fraction of transactions traced, 0–1. Default 0: §9.4 asks for ERROR monitoring, and
   * tracing every request on a small shop's plan burns the quota that errors need.
   */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
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

  /**
   * The site's public origin, e.g. `https://tirupatijewelles.com`.
   *
   * Added by Phase 6 (§6.3). The WhatsApp enquiry message embeds an absolute link back to
   * the product, and the server cannot reliably know its own public origin behind a proxy.
   * The alternative — reading `window.location.origin` in an effect — would mean the link
   * is wrong in the server-rendered HTML and only corrected after hydration, so it would
   * be wrong for a visitor with JavaScript disabled and briefly wrong for everyone else.
   *
   * Known at build time, so the message is identical on the server and the client and no
   * effect is needed. Trailing slash stripped so `${SITE_URL}/products/x` never doubles up.
   */
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url('NEXT_PUBLIC_SITE_URL must be an absolute URL, e.g. https://example.com')
    .default('http://localhost:3000')
    .transform((v) => v.replace(/\/+$/, '')),
});

const clientValues = {
  NEXT_PUBLIC_OWNER_WA: process.env.NEXT_PUBLIC_OWNER_WA,
  NEXT_PUBLIC_TICKER_JITTER: process.env.NEXT_PUBLIC_TICKER_JITTER,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
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
