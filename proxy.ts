/**
 * Request proxy — runs before any route renders.
 * Created by Phase 2 (specs/02-design-system.md §2.5).
 *
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` with a `proxy` export (D-002). Where a
 * phase file says "middleware", it means this.
 *
 * Phase 3 §3.6 adds session checks for /account/* and /admin/* here. That will guard the
 * edge — and, per the same section, every admin handler re-checks the role itself, because
 * this file is not a security boundary on its own.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /**
   * §2.5: the component gallery is dev-only, "blocked in production middleware".
   *
   * Checked here rather than only in the page so the route is unreachable in production
   * even if a build or export step were to emit it. Acceptance criterion 1 requires
   * /__design to 404 with NODE_ENV=production.
   */
  if (pathname.startsWith('/__design') && process.env.NODE_ENV === 'production') {
    // A rewrite to a non-existent path yields the app's own 404 — no redirect, no hint
    // that the route exists at all.
    return NextResponse.rewrite(new URL('/__not-found', request.url));
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
