import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AUTH_COOKIE } from "@/lib/api";

// In Next 16 the `middleware` file convention was renamed to `proxy`.
// Same behaviour, new name.

const PROTECTED_PREFIXES = ["/account"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

  // Deliberately an *optimistic* check — presence of the cookie only, no call
  // to the API. Proxy runs on every request including prefetches, so a network
  // round-trip here would tax every navigation. The real verification is the
  // signature check FastAPI does on /auth/me; this only saves an obvious
  // redirect. Never treat it as the authorization boundary.
  if (request.cookies.has(AUTH_COOKIE)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Without a matcher this runs on static assets and images too.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
