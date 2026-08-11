/**
 * Send an already-authenticated visitor away from an auth screen.
 * Created by the UI redesign, Stage 3 (audit C-4).
 *
 * ── Why this is a page check and not a proxy rule ──
 *
 * `proxy.ts` could do this in one line, and it would be wrong. The proxy deliberately reads
 * only whether a session COOKIE exists — it says so at the top of the file, and that is a UX
 * signal rather than a fact about the caller. A cookie whose session has expired, been
 * revoked, or been dropped from Redis still looks exactly like a valid one from there.
 *
 * Bouncing on that signal produces the loop brief §11 forbids: stale cookie hits `/login`,
 * proxy sends it to `/account`, `/account` resolves the real session, finds nothing, and
 * redirects back to `/login?next=/account`. The user cannot sign in because the sign-in page
 * refuses to render for them.
 *
 * Resolving the session here means a stale cookie falls through to the form, which is exactly
 * what someone whose session just expired needs to see. It costs the page its static
 * rendering — `/login` and `/signup` become dynamic — and that is the correct trade: a page
 * whose output depends on who is asking was never really static.
 *
 * This is NOT an authorisation boundary and does not become one. It only chooses a
 * destination; `requireAdminPage()` still guards `/admin`, unchanged.
 */
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/guard';
import { destinationAfterAuth } from '@/lib/auth/safe-next';

/**
 * Redirects and never returns when a real session exists; returns normally otherwise.
 *
 * `next` is honoured so that a signed-in user following `/login?next=/products/x` lands on
 * the product rather than on their account. `destinationAfterAuth` refuses to return an auth
 * route, which is what stops `?next=/login` from bouncing forever.
 */
export async function redirectIfSignedIn(next?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  redirect(destinationAfterAuth(next, user.role));
}
