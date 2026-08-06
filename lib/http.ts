/**
 * Route handler helpers — validation, errors, client IP.
 * Created by Phase 3 (specs/03-auth.md §3.4).
 *
 * SECURITY, every phase: "Every route body/query parsed through a Zod schema. Reject,
 * don't coerce." Phase 9 §9.1 adds a test that enumerates route files and fails if one
 * lacks a schema import — so this helper is the single place that behaviour is defined.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type { z } from 'zod';

import { env } from '@/lib/env';
import { log } from '@/lib/log';

/** Route handlers must never be cached (MASTER-SPEC §6). */
export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function json<T>(body: T, status = 200, headersInit?: HeadersInit): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...headersInit },
  });
}

export function errorJson(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return json({ error: message, ...extra }, status);
}

/**
 * Generic failure for anything auth-related.
 *
 * SECURITY §3: unknown-user and wrong-password must be "identical in body, status, and
 * timing". One shared constant is how the bodies stay identical as the code changes.
 */
export const GENERIC_AUTH_ERROR = 'Those details did not match. Please try again.';

export type ParseResult<T> =
  { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Parse and validate a JSON body.
 *
 * Field-level messages are returned because they are needed for usable forms — but callers
 * on auth paths must collapse them to `GENERIC_AUTH_ERROR` rather than revealing which
 * identifier exists.
 */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParseResult<z.infer<S>>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: errorJson('Expected a JSON body.', 400) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    return {
      ok: false,
      response: errorJson('Check the highlighted fields.', 400, { fields }),
    };
  }

  return { ok: true, data: parsed.data };
}

/** Parse and validate query parameters. */
export function parseQuery<S extends z.ZodType>(
  request: Request,
  schema: S,
): ParseResult<z.infer<S>> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse(params);

  if (!parsed.success) {
    return { ok: false, response: errorJson('Invalid query parameters.', 400) };
  }
  return { ok: true, data: parsed.data };
}

/**
 * The origin verdict, as a value rather than a response.
 *
 * ── Why this is a separate function (SEC-028) ──
 * There are two callers with two different return types: a route handler needs a
 * `NextResponse`, a Server Action cannot return one. Phase 7 solved that by writing the
 * logic twice, and the copies drifted: SEC-017's fix — reject a downgraded `http://` origin
 * in production — was applied to the route-handler copy only, so every admin mutation in the
 * application (all of which are Server Actions, D-024) still accepted one. The comment on
 * the second copy asserted "the logic is identical and both are tested"; neither half was
 * true.
 *
 * So the decision lives here once and the two shapes are thin wrappers. A control that is
 * stated twice is a control that will eventually be true once.
 *
 * `absent` is distinguished from `ok` because the callers report it differently, not because
 * either rejects it — see `requireSameOrigin`.
 */
export type OriginVerdict = 'ok' | 'absent' | 'malformed' | 'mismatch';

export async function checkSameOrigin(): Promise<OriginVerdict> {
  const h = await headers();
  const origin = h.get('origin');

  /**
   * No Origin — not a browser form post.
   *
   * That is a server-to-server caller (curl, the Playwright request fixture, a health
   * check), which is not a CSRF scenario: CSRF requires a browser with an ambient cookie,
   * and a browser always sends the header on a cross-origin request and on same-origin
   * POSTs. It also cannot be set by page JavaScript.
   */
  if (!origin) return 'absent';

  const host = h.get('host');
  if (!host) return 'malformed';

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return 'malformed';
  }

  /**
   * In production the origin must be https.
   *
   * `Host` carries no scheme, so comparing hosts alone would accept
   * `http://shop.example` against a host of `shop.example` — the ports normalise away and
   * the two look identical. That admits a downgraded origin, which is exactly the position
   * a network attacker wants to be in. Development is exempt because it runs on
   * `http://localhost`.
   */
  if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    return 'mismatch';
  }

  return parsed.host === host ? 'ok' : 'mismatch';
}

/**
 * Reject a state-changing request that did not come from our own origin.
 *
 * Created by Phase 7 (specs/07-admin-panel.md §7 SECURITY: "CSRF: state-changing routes
 * require `SameSite=Lax` plus an origin check").
 *
 * ── Why this exists when the cookie is already SameSite=Lax ──
 * Lax does block the session cookie on a cross-site POST, so this is defence in depth
 * rather than a hole being closed. But it makes the browser's default the *only* control,
 * and Lax has edge cases — a same-site-but-different-subdomain attacker, and browsers that
 * treat the default differently. One header check costs nothing and removes the dependency.
 *
 * Applied to every mutating handler in the application, not only Phase 7's. A control that
 * only guards code written after it was invented has a hole in the shape of the older code.
 */
export async function requireSameOrigin(): Promise<NextResponse | null> {
  switch (await checkSameOrigin()) {
    case 'ok':
    case 'absent':
      return null;
    case 'malformed':
      return errorJson('Bad request.', 400);
    case 'mismatch':
      // Deliberately terse. Naming the expected origin would help an attacker tune, and a
      // legitimate caller never sees this.
      return errorJson('Bad request.', 403);
  }
}

/**
 * Is this address one an infrastructure component would have, rather than a visitor?
 *
 * Private (RFC 1918), loopback, link-local — including `169.254.169.254`, the cloud
 * metadata address — and the CGNAT range carriers use between their own hops. IPv6
 * loopback and unique-local too.
 */
function isInfrastructureAddress(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 100.64.0.0/10 — carrier-grade NAT, used between provider hops.
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // fc00::/7 unique-local, fe80::/10 link-local.
  return /^(f[cd]|fe[89ab])/.test(lower);
}

/**
 * Derive the client IP from a set of request headers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  SEC-032 / DEBT-009. Read from the RIGHT, never the left.
 *
 *  `x-forwarded-for` is a list that each proxy appends to, so the LEFTMOST entry is
 *  whatever the original caller sent — attacker-controlled. Taking it, which this function
 *  used to do, means anyone can present a fresh identity per request and every per-IP limit
 *  in the application becomes decorative: OTP send and verify, login, the claim token,
 *  calculator shares, enquiries, bill creation, and the global limit in `proxy.ts`.
 *
 *  Counting from the right instead means reading the entry written by a proxy we trust.
 *
 *  ── The failure mode this must not have ──
 *  If the hop count is wrong, the entry selected is a load balancer's own address — so
 *  every visitor collapses into one bucket and the global limiter locks out the whole site.
 *  That is worse than the problem being fixed, so it is designed out rather than hoped
 *  away: an address that belongs to infrastructure is never accepted as an identity, and we
 *  fall back to the rightmost PUBLIC entry, which is correct under any hop count.
 *
 *  What remains is one ops confirmation that cannot be made from inside the repository:
 *  send a forged header through the real deployment and log what arrives. DEBT-009 stays
 *  open until that has been run.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function clientIpFromHeaders(h: Headers): string {
  const forwarded = h.get('x-forwarded-for');

  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length > 0) {
      const atHop = parts[Math.max(0, parts.length - env.TRUSTED_PROXY_HOPS)];
      if (atHop && !isInfrastructureAddress(atHop)) return atHop;

      // The hop count does not match reality. Take the rightmost address that could
      // actually belong to a visitor rather than trusting a number in an env var.
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const candidate = parts[i];
        if (candidate && !isInfrastructureAddress(candidate)) return candidate;
      }

      // Everything is private — a purely internal caller, or local development.
      if (atHop) return atHop;
    }
  }

  const real = h.get('x-real-ip');
  if (real) return real;

  /**
   * No forwarding headers at all. Every such caller shares one bucket, which is the
   * conservative direction: it over-limits rather than under-limits, and in practice this
   * is development and the test suite.
   */
  return '0.0.0.0';
}

/** Best-effort client IP for rate limiting. See `clientIpFromHeaders`. */
export async function clientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}

/**
 * Equalise response time on paths that branch on whether an account exists.
 *
 * SECURITY §3 requires the unknown-user path to take as long as the wrong-password path.
 * The real defence is the dummy Argon2 verification in the login handler; this pads the
 * remainder so the *total* is flat.
 */
export async function padTo(startedAt: number, targetMs = 300): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < targetMs) {
    await new Promise((resolve) => setTimeout(resolve, targetMs - elapsed));
  }
}

/**
 * Never leak a stack trace in production (Phase 9 §9.1).
 *
 * The response side was already correct. The LOG side was not: Prisma serialises its whole
 * argument object into a validation error, so this line printed customers' emails and phone
 * numbers verbatim (SEC-031). It now goes through the redacting logger.
 */
export function serverError(err: unknown, context: string): NextResponse {
  log.error(`route failed: ${context}`, { route: context, err });
  return errorJson(
    env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : `${context}: ${err instanceof Error ? err.message : String(err)}`,
    500,
  );
}
