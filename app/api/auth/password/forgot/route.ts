/**
 * POST /api/auth/password/forgot
 * Created by Phase 3 (specs/03-auth.md §3.4).
 *
 * Uses the same OTP machinery as everything else rather than a separate emailed reset
 * token. §3.2's guarantees — peppered digest, 5-minute TTL, single use, 6-attempt lockout,
 * rate limits — then apply to password reset for free, and SECURITY reviews one mechanism
 * instead of two.
 *
 * SECURITY §3 requires reset tokens to be "single-use, 1-hour TTL, invalidated on use and
 * on password change". The OTP is stricter on TTL (5 minutes) and single-use is enforced
 * atomically; `destroyAllSessions` on reset covers the invalidation half.
 */
import { Channel } from '@prisma/client';

import { normaliseIdentifier } from '@/lib/auth/identifier';
import { issueOtp, OtpPurpose } from '@/lib/auth/otp';
import { consumeAll, OTP_LIMITS } from '@/lib/auth/rate-limit';
import { passwordForgotSchema } from '@/lib/auth/schemas';
import { db } from '@/lib/db';
import { clientIp, errorJson, json, padTo, parseBody, serverError } from '@/lib/http';
import { sendOtp } from '@/lib/notify';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const startedAt = Date.now();

  const parsed = await parseBody(request, passwordForgotSchema);
  if (!parsed.ok) return parsed.response;

  const normalised = normaliseIdentifier(parsed.data.identifier);
  const ip = await clientIp();

  const limit = await consumeAll([
    OTP_LIMITS.sendPerIdentifier(normalised.value ?? parsed.data.identifier),
    OTP_LIMITS.sendPerIp(ip),
  ]);
  if (!limit.allowed) {
    return errorJson('Too many requests. Try again shortly.', 429, {
      retryAfter: limit.retryAfter,
    });
  }

  try {
    if (normalised.kind !== 'invalid') {
      const user = await db.user.findUnique({
        where:
          normalised.kind === 'email'
            ? { email: normalised.value }
            : { phone: normalised.value },
        select: { id: true },
      });

      if (user) {
        const channel = normalised.kind === 'email' ? Channel.EMAIL : Channel.SMS;
        const { code } = await issueOtp(
          normalised.value,
          OtpPurpose.PASSWORD_RESET,
          channel,
        );
        await sendOtp(channel, normalised.value, code);
      }
    }

    /**
     * Always the same answer.
     *
     * "No account with that email" would make this endpoint an unauthenticated
     * account-existence oracle over the entire customer list — the exact enumeration issue
     * SECURITY §3 calls out. The padding keeps the timing flat too, since the branch that
     * sends does real work.
     */
    await padTo(startedAt, 400);
    return json({
      sent: true,
      message: 'If that account exists, we have sent a verification code.',
    });
  } catch (err) {
    return serverError(err, 'password/forgot');
  }
}
