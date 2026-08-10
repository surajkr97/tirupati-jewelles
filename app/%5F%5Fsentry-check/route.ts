/**
 * Dev-only: throw a server error carrying invented identifiers, so §9.4's PII scrubbing can
 * be verified against the REAL transport.
 * Created by Phase 9 (§9.4, DEBT-047).
 *
 * ── Why this is a route and not a script ──
 * A standalone `tsx` script cannot exercise the path that matters. Outside Next,
 * `@sentry/nextjs` resolves to its BROWSER build — `init` exists, `captureException` does
 * not — so a script would either fail outright or, worse, verify a different SDK from the
 * one production runs. Found by running it: the first version of `pnpm verify:sentry` got
 * `Sentry.captureMessage is not a function` from a package whose types were perfectly happy.
 *
 * Throwing inside a real route handler exercises the whole chain instead:
 * `instrumentation.ts` → `initMonitoring()` → the server SDK → `beforeSend` → the wire.
 * That is the chain DEBT-047 says has never been tested.
 *
 * ── Blocked in production twice over ──
 * The same belt-and-braces `/__design` uses (§2.5): `proxy.ts` rewrites the path away under
 * `NODE_ENV=production`, and this handler independently 404s. One guard can be edited out by
 * accident; two in different files cannot.
 *
 * `%5F%5F` in the directory name is the documented escape — Next treats a leading underscore
 * as a private folder and would exclude the route from the router entirely.
 */
import { NextResponse } from 'next/server';

import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Invented, and deliberately recognisable in a Sentry issue list. The number is in the
 * reserved 99999xxxxx range and the address is on `example.com`; neither belongs to anyone.
 */
const PHONE = '+919999900001';
const EMAIL = 'verify-scrubbing@example.com';

export async function GET() {
  if (env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }

  /**
   * Shaped like the leak DEBT-036 actually measured — a Prisma unique-constraint error
   * quoting the value that collided — because that is the error most likely to carry a
   * customer identifier in production.
   *
   * Thrown rather than captured: `onRequestError` in `instrumentation.ts` is the hook that
   * catches a server error and is the part with no test coverage. Calling `captureException`
   * here would bypass exactly the thing being verified.
   */
  throw new Error(
    `verify:sentry — Unique constraint failed on the fields: (email) with value ${EMAIL} for ${PHONE}`,
  );
}
