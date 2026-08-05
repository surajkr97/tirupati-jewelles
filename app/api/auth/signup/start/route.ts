/**
 * POST /api/auth/signup/start — email → OTP.
 * Created by Phase 3 (specs/03-auth.md §3.4).
 */
import { Channel } from '@prisma/client';

import { issueOtp, OtpPurpose } from '@/lib/auth/otp';
import { consumeAll, OTP_LIMITS } from '@/lib/auth/rate-limit';
import { signupStartSchema } from '@/lib/auth/schemas';
import { db } from '@/lib/db';
import { clientIp, errorJson, json, padTo, parseBody, serverError } from '@/lib/http';
import { sendOtp } from '@/lib/notify';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const startedAt = Date.now();

  const parsed = await parseBody(request, signupStartSchema);
  if (!parsed.ok) return parsed.response;

  const { email } = parsed.data;
  const ip = await clientIp();

  const limit = await consumeAll([
    OTP_LIMITS.sendPerIdentifier(email),
    OTP_LIMITS.sendPerIp(ip),
  ]);
  if (!limit.allowed) {
    return errorJson('Too many requests. Try again shortly.', 429, {
      retryAfter: limit.retryAfter,
    });
  }

  try {
    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });

    /**
     * Enumeration defence.
     *
     * An already-registered email gets the SAME response as a new one — no code is sent,
     * but the caller cannot tell. Replying "that email is taken" here would turn signup
     * into a free account-existence oracle for the whole customer list.
     *
     * A row that exists without a passwordHash is an unfinished signup, so it is allowed
     * to continue and receive a code.
     */
    const alreadyRegistered = existing?.passwordHash != null;

    if (!alreadyRegistered) {
      const { code } = await issueOtp(email, OtpPurpose.SIGNUP, Channel.EMAIL);
      await sendOtp(Channel.EMAIL, email, code);
    }

    await padTo(startedAt);
    return json({ sent: true });
  } catch (err) {
    return serverError(err, 'signup/start');
  }
}
