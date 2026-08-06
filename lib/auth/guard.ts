/**
 * Server-side authorisation guards.
 * Created by Phase 3 (specs/03-auth.md §3.6).
 *
 * §3.6: "Admin routes additionally re-check role === 'ADMIN' INSIDE THE HANDLER. Middleware
 * alone is not a security boundary."
 *
 * `proxy.ts` is a UX convenience — it redirects a signed-out visitor to /login before a page
 * renders. It is not the boundary. Route matchers have edge cases, proxies can be bypassed
 * by deployment topology, a `matcher` regex is one typo away from exempting a route, and
 * Server Actions arrive as POSTs to their own page's route — so moving one silently changes
 * its proxy coverage. Every protected handler calls a guard from this file.
 *
 * (This comment used to say the proxy "runs at the edge". Next 16 runs it on the Node.js
 * runtime; Phase 9 §9.1 corrected the reasoning without weakening the rule.)
 *
 * §3.6 also requires 404, not 403, for non-admins: a 403 confirms the route exists.
 */
import { notFound } from 'next/navigation';

import { db } from '@/lib/db';
import { getSession, type SessionData } from '@/lib/auth/session';

/**
 * Columns that are safe to return.
 *
 * SECURITY §3: "No user object returned anywhere includes passwordHash. Use an explicit
 * Prisma select, never exclude-by-convention." An explicit allowlist means a column added
 * to the schema later is invisible until someone deliberately adds it here.
 */
export const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  phone: true,
  name: true,
  role: true,
  phoneVerified: true,
  emailVerified: true,
  createdAt: true,
} as const;

export type PublicUser = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  role: 'CUSTOMER' | 'ADMIN';
  phoneVerified: boolean;
  emailVerified: boolean;
  createdAt: Date;
};

/** The signed-in user, or null. Never throws. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const session = await getSession();
  if (!session) return null;

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: PUBLIC_USER_SELECT,
  });

  // The session outlived the account — treat as signed out rather than 500.
  return user ?? null;
}

/** The current session, or null. Cheaper than `getCurrentUser` when only the id is needed. */
export async function getCurrentSession(): Promise<SessionData | null> {
  return getSession();
}

export class UnauthorisedError extends Error {
  constructor() {
    super('Not authenticated');
    this.name = 'UnauthorisedError';
  }
}

/** Require any signed-in user. Throws — route handlers map this to 401. */
export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorisedError();
  return user;
}

/**
 * Require an ADMIN.
 *
 * Throws `UnauthorisedError` for everyone else — customer session and no session alike —
 * so the caller returns an identical 404 either way and the route's existence is not
 * confirmed.
 */
export async function requireAdmin(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') throw new UnauthorisedError();
  return user;
}

/**
 * Page-level admin guard. Renders the 404 page for non-admins.
 * Use in `/admin/*` server components; use `requireAdmin` in route handlers.
 */
export async function requireAdminPage(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') notFound();
  return user;
}
