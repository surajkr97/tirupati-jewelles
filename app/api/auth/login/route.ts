/**
 * POST /api/auth/login — one field, phone or email.
 * Created by Phase 3 (specs/03-auth.md §3.4).
 *
 * ── Enumeration ──
 * SECURITY §3: "wrong-password and unknown-user responses are identical in body, status,
 * and timing. Add a dummy hash verification on the unknown-user path so response time
 * matches — otherwise timing leaks account existence."
 *
 * Both defences are here: every failure returns `GENERIC_AUTH_ERROR` with 401, and the
 * unknown-user branch performs a real Argon2 verification against a throwaway hash so it
 * costs the same ~50ms as a genuine check. Without it, "user not found" returns in
 * microseconds and the difference is trivially measurable over a few requests.
 */
import { ARGON2_OPTIONS, verifyPassword } from '@/lib/auth/argon2';
import { PUBLIC_USER_SELECT } from '@/lib/auth/guard';
import { normaliseIdentifier } from '@/lib/auth/identifier';
import { consumeAll, LOGIN_LIMITS, reset } from '@/lib/auth/rate-limit';
import { loginSchema } from '@/lib/auth/schemas';
import { createSession } from '@/lib/auth/session';
import { db } from '@/lib/db';
import {
  GENERIC_AUTH_ERROR,
  clientIp,
  errorJson,
  json,
  padTo,
  parseBody,
  requireSameOrigin,
  serverError,
} from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * A real Argon2id digest of a random string, used only to burn the same CPU on the
 * unknown-user path. Generated once at module load, never compared for truth.
 */
let decoyHash: string | null = null;

async function decoy(password: string): Promise<void> {
  if (!decoyHash) {
    const { hash } = await import('@node-rs/argon2');
    decoyHash = await hash(`decoy-${Math.random()}-${Date.now()}`, ARGON2_OPTIONS);
  }
  await verifyPassword(decoyHash, password);
}

export async function POST(request: Request) {
  // CSRF: reject a cross-origin state change (Phase 7 §7 SECURITY).
  const crossOrigin = await requireSameOrigin();
  if (crossOrigin) return crossOrigin;

  const startedAt = Date.now();

  const parsed = await parseBody(request, loginSchema);
  if (!parsed.ok) return parsed.response;

  const { identifier, password } = parsed.data;
  const ip = await clientIp();

  const normalised = normaliseIdentifier(identifier);

  // Even a malformed identifier pays the full cost — returning early would make "that is
  // not a valid phone number" distinguishable by timing from "no such account".
  if (normalised.kind === 'invalid') {
    await decoy(password);
    await padTo(startedAt);
    return errorJson(GENERIC_AUTH_ERROR, 401);
  }

  const limit = await consumeAll([
    LOGIN_LIMITS.perIdentifier(normalised.value),
    LOGIN_LIMITS.perIp(ip),
  ]);
  if (!limit.allowed) {
    return errorJson('Too many attempts. Try again later.', 429, {
      retryAfter: limit.retryAfter,
    });
  }

  try {
    const user = await db.user.findUnique({
      where:
        normalised.kind === 'email'
          ? { email: normalised.value }
          : { phone: normalised.value },
      // passwordHash is needed here and ONLY here; it is never returned.
      select: { ...PUBLIC_USER_SELECT, passwordHash: true },
    });

    if (!user?.passwordHash) {
      await decoy(password);
      await padTo(startedAt);
      return errorJson(GENERIC_AUTH_ERROR, 401);
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      await padTo(startedAt);
      return errorJson(GENERIC_AUTH_ERROR, 401);
    }

    // Fresh session id on every login — §3.3's rotation requirement, which defeats
    // session fixation.
    await createSession({ userId: user.id, role: user.role });
    await reset(LOGIN_LIMITS.perIdentifier(normalised.value).key);

    const { passwordHash: _discard, ...publicUser } = user;
    void _discard;

    await padTo(startedAt);
    return json({ user: publicUser });
  } catch (err) {
    return serverError(err, 'login');
  }
}
