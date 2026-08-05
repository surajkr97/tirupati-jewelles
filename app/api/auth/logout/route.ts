/**
 * POST /api/auth/logout
 * Created by Phase 3 (specs/03-auth.md §3.3).
 *
 * Deletes the Redis key, not just the cookie — clearing only the cookie leaves a valid
 * session id that anyone who captured it can keep using.
 *
 * Deliberately unauthenticated: logging out with an already-expired session should still
 * clear the cookie rather than fail with a 401.
 */
import { destroyAllSessions, destroySession, getSession } from '@/lib/auth/session';
import { json, parseBody, requireSameOrigin, serverError } from '@/lib/http';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const logoutSchema = z.object({
  /** "Log out of all devices" (§3.3). */
  everywhere: z.boolean().optional(),
});

export async function POST(request: Request) {
  // CSRF: reject a cross-origin state change (Phase 7 §7 SECURITY).
  const crossOrigin = await requireSameOrigin();
  if (crossOrigin) return crossOrigin;

  try {
    // The body is optional; a bare logout with no payload is the common case.
    const parsed = await parseBody(request, logoutSchema).catch(() => null);
    const everywhere = parsed?.ok ? parsed.data.everywhere : false;

    if (everywhere) {
      const session = await getSession();
      if (session) await destroyAllSessions(session.userId);
    }

    await destroySession();
    return json({ signedOut: true });
  } catch (err) {
    return serverError(err, 'logout');
  }
}
