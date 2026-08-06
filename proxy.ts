/**
 * Request proxy — runs before any route renders.
 * Created by Phase 2 (§2.5), extended by Phase 3 (specs/03-auth.md §3.6).
 *
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` with a `proxy` export (D-002). Where a
 * phase file says "middleware", it means this.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THIS FILE IS NOT A SECURITY BOUNDARY.
 *
 *  §3.6: "Admin routes additionally re-check role === 'ADMIN' inside the handler.
 *  Middleware alone is not a security boundary — it can be bypassed by routing edge
 *  cases."
 *
 *  What happens here is a UX shortcut: bounce a signed-out visitor to /login before a
 *  page renders, and hide /admin from non-admins. The real check is `requireAdmin()` /
 *  `requireAdminPage()` from lib/auth/guard.ts, called inside every protected handler
 *  and page.
 *
 *  It deliberately does NOT read the session from Redis. Next 16 runs this on the Node.js
 *  runtime, so it could — the global rate limiter below does exactly that — but resolving
 *  a session here would create a second authorisation path that looks authoritative and
 *  is not. All it checks is whether a session COOKIE exists, which is a UX signal, not a
 *  fact about the caller.
 *
 *  (An earlier version of this comment said the proxy "runs at the edge and cannot reach
 *  Redis or Prisma". That was true of Next 14/15 middleware and is not true here — Phase 9
 *  §9.1 corrected it. The rule survives the correction; only the reason changed.)
 * ══════════════════════════════════════════════════════════════════════════
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { clientIpFromHeaders } from '@/lib/http';
import { consumeGlobalLimit, isPrefetch } from '@/lib/security/global-limit';

/** Must match SESSION_COOKIE in lib/auth/session.ts — that module cannot be imported here. */
const SESSION_COOKIE = 'tj_session';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /**
   * §9.1: "Global rate limiting in proxy, per-IP, Redis-backed."
   *
   * First, so a flood is refused before any routing or rendering work happens. It fails
   * OPEN — a Redis outage must not take the site down; see lib/security/global-limit.ts,
   * which explains why this is the opposite of the auth limiter's behaviour.
   *
   * EVERY request through this proxy is counted. There is no path and no header that opts
   * out — prefetches and `/api/health` are isolated into their own buckets rather than
   * excused, because an exemption a client can request is not a limit (Phase 9 TEST,
   * findings 1 and 2).
   */
  const ip = clientIpFromHeaders(request.headers);
  const limit = await consumeGlobalLimit(ip, pathname, {
    prefetch: isPrefetch(request),
  });

  if (!limit.allowed) {
    return new NextResponse('Too many requests', {
      status: 429,
      headers: {
        'Retry-After': String(limit.retryAfter),
        'Cache-Control': 'no-store',
        // Says nothing about which tier was hit or how much is left; a limiter that
        // reports its own state is a limiter an attacker can tune against.
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }

  /**
   * §2.5: the component gallery is dev-only, "blocked in production middleware".
   * Rewritten to a non-existent path so it yields the app's own 404 with no redirect and
   * no hint that the route exists.
   */
  if (pathname.startsWith('/__design') && process.env.NODE_ENV === 'production') {
    return NextResponse.rewrite(new URL('/__not-found', request.url));
  }

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  /**
   * /admin/* — a missing cookie yields 404, never 403 or a redirect to /login.
   *
   * §3.6: "Return 404, not 403, on admin routes for non-admins. Do not confirm the route
   * exists." A redirect to /login would confirm it just as loudly as a 403.
   *
   * A cookie only gets the request past this point; `requireAdminPage()` then checks the
   * actual role and 404s a signed-in customer.
   */
  if (pathname.startsWith('/admin')) {
    if (!hasSessionCookie) {
      return NextResponse.rewrite(new URL('/__not-found', request.url));
    }
    return NextResponse.next();
  }

  /**
   * /account/* — a redirect is right here. The route is not secret, the visitor simply
   * needs to sign in, and `next` returns them to where they were going.
   */
  if (pathname.startsWith('/account') && !hasSessionCookie) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Without a matcher this runs on every request including static assets. Exclude
   * _next/static, _next/image, favicon and common asset extensions so CSS, JS and images
   * are never routed through auth logic.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)',
  ],
};
