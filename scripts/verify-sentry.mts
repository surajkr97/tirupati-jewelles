/**
 * Prove the PII scrubbing works against the REAL Sentry transport.
 *
 *   pnpm verify:sentry
 *
 * ── Why this exists ──
 * `lib/monitoring/monitoring.test.ts` asserts `scrubEvent` removes phone numbers, emails and
 * session ids from seven realistic event shapes. That is a unit test: it calls the function
 * directly and never goes near the SDK. So it proves the scrubber is correct and proves
 * nothing about whether it is *installed* — a `beforeSend` that is never wired, or wired and
 * then overwritten by Sentry's setup wizard, passes every one of those tests.
 *
 * DEBT-047 is open on exactly that gap. This closes it the only way it can be closed: send
 * real events through the real pipe and look at what arrives.
 *
 * ── Why it drives a ROUTE rather than sending events itself ──
 * A standalone script cannot exercise the path that matters. Outside Next, `@sentry/nextjs`
 * resolves to its BROWSER build — `init` exists, `captureException` does not — so the first
 * version of this script died on `Sentry.captureMessage is not a function` from a package
 * whose types were perfectly happy. Had it resolved, it would have verified a different SDK
 * from the one production runs, which is worse than failing.
 *
 * So it asks the running dev server to throw, and the error travels the real chain:
 * `instrumentation.ts` → `initMonitoring()` → the server SDK → `beforeSend` → the wire.
 * `onRequestError` — the hook with no test coverage — is part of that chain.
 *
 * Nothing here touches the database and every value is invented: the phone number is in the
 * reserved 99999xxxxx range and the address is on `example.com`.
 */
import { config } from 'dotenv';

// `.env` first, then dynamic imports: `lib/env.ts` parses at import time and `tsx` does not
// load `.env` on its own. Same ordering as `scripts/worker.mts` and `scripts/lighthouse.mts`.
config({ path: '.env', quiet: true });

const { env } = await import('@/lib/env');

/** Invented, and deliberately recognisable in a Sentry issue list. */
const PHONE = '+919999900001';
const EMAIL = 'verify-scrubbing@example.com';
const SESSION = 'sess_verify_do_not_reuse_0123456789';

async function main(): Promise<void> {
  if (!env.SENTRY_DSN) {
    console.error(
      [
        'SENTRY_DSN is not set, so there is nothing to verify.',
        '',
        'This is a supported state — the application runs fine without it, and CI runs',
        'that way. To run this check, put the DSN from',
        '  Sentry → Settings → Projects → <project> → Client Keys (DSN)',
        'into .env, restart `pnpm dev`, then run this again.',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const origin = process.env.VERIFY_ORIGIN ?? 'http://localhost:3000';
  const url = `${origin}/__sentry-check`;

  let status: number;
  try {
    // A 500 is the SUCCESS case: the route threw, which is the whole point.
    status = (await fetch(url)).status;
  } catch {
    console.error(
      [
        `Could not reach ${url}.`,
        '',
        'Start the dev server first:  pnpm dev',
        'The route is dev-only — it 404s under NODE_ENV=production, by two guards.',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  if (status === 404) {
    console.error(
      `${url} returned 404. That route is blocked in production; run this against a dev server.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`✓ ${url} → ${status} (a 500 is correct: the route threw on purpose)`);
  console.log('');
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log('The dev server should have logged `monitoring.enabled` at boot. If it');
  console.log('logged `monitoring.disabled`, the DSN was added after it started —');
  console.log('restart `pnpm dev` and run this again.');
  console.log('');
  console.log('NOW OPEN SENTRY. The newest issue should be:');
  console.log('  "verify:sentry — Unique constraint failed on the fields: (email)…"');
  console.log('');
  console.log('Search the whole event — message, exception, tags, extra, request.');
  console.log('NEITHER of these may appear anywhere in it:');
  console.log(`  ${PHONE}`);
  console.log(`  ${EMAIL}`);
  console.log('');
  console.log('This SHOULD still appear, or the scrubber has removed the diagnosis');
  console.log('along with the identifier and the reports are useless:');
  console.log('  "Unique constraint failed on the fields"');
  console.log('');
  console.log('If either identifier survived, DO NOT DEPLOY with this DSN set —');
  console.log("`beforeSend` is not installed. The usual cause is Sentry's setup wizard");
  console.log('having written its own sentry.*.config.ts files, which replace the');
  console.log('hand-written init in lib/monitoring/sentry.ts.');
  console.log('');
  console.log('Delete the issue afterwards; it is noise.');
  console.log('─────────────────────────────────────────────────────────────────────');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
