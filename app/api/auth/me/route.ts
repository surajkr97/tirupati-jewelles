/**
 * GET /api/auth/me
 * Created by Phase 3 (specs/03-auth.md §3.4).
 */
import { getCurrentUser } from '@/lib/auth/guard';
import { json, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    // 200 with `user: null` rather than 401 — this endpoint answers "who am I", and being
    // signed out is a valid answer, not an error the client must special-case.
    return json({ user });
  } catch (err) {
    return serverError(err, 'auth/me');
  }
}
