/**
 * POST /api/auth/password/reset
 * Created by Phase 3 (specs/03-auth.md §3.4).
 *
 * SECURITY §3: the token must be "invalidated on use and on password change". The OTP is
 * consumed atomically by `verifyOtp`, and every existing session is destroyed — a password
 * reset is exactly the moment to evict an attacker who already has a session.
 */
import { hashPassword } from '@/lib/auth/argon2';
import { normaliseIdentifier } from '@/lib/auth/identifier';
import { OtpPurpose, verifyOtp } from '@/lib/auth/otp';
import { checkPassword } from '@/lib/auth/password-policy';
import { consumeAll, OTP_LIMITS } from '@/lib/auth/rate-limit';
import { passwordResetSchema } from '@/lib/auth/schemas';
import { createSession, destroyAllSessions } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { clientIp, errorJson, json, parseBody, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const parsed = await parseBody(request, passwordResetSchema);
  if (!parsed.ok) return parsed.response;

  const { code, password } = parsed.data;
  const normalised = normaliseIdentifier(parsed.data.identifier);
  if (normalised.kind === 'invalid') {
    return errorJson('That code is not valid. Request a new one.', 400);
  }

  const policy = checkPassword(password);
  if (!policy.ok) {
    return errorJson('Check the highlighted fields.', 400, {
      fields: { password: policy.reason },
    });
  }

  const ip = await clientIp();
  const limit = await consumeAll([OTP_LIMITS.verifyPerIp(ip)]);
  if (!limit.allowed) {
    return errorJson('Too many attempts. Try again later.', 429, {
      retryAfter: limit.retryAfter,
    });
  }

  try {
    const verified = await verifyOtp(normalised.value, OtpPurpose.PASSWORD_RESET, code);
    if (!verified.ok) {
      return errorJson('That code is not valid. Request a new one.', 400, {
        expired: true,
      });
    }

    const user = await db.user.findUnique({
      where:
        normalised.kind === 'email'
          ? { email: normalised.value }
          : { phone: normalised.value },
      select: { id: true, role: true },
    });

    // The code verified but the account vanished between request and reset. Nothing to do.
    if (!user) return errorJson('That code is not valid. Request a new one.', 400);

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });

    // Evict every existing session, including any the attacker holds, then sign this
    // caller back in with a fresh id.
    await destroyAllSessions(user.id);
    await createSession({ userId: user.id, role: user.role });

    return json({ reset: true });
  } catch (err) {
    return serverError(err, 'password/reset');
  }
}
