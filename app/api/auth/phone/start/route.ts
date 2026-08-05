/**
 * POST /api/auth/phone/start — add a mobile number as a login identifier. [authed]
 * Created by Phase 3 (specs/03-auth.md §3.4), revised for email-only delivery (D-011).
 *
 * The code goes to the account's VERIFIED EMAIL, not to the phone, because SMS is not
 * enabled. That proves the requester controls this account — enough to let them attach a
 * number they will log in with, and deliberately NOT enough to claim orders billed to it.
 */
import { Channel } from '@prisma/client';

import { requireUser, UnauthorisedError } from '@/lib/auth/guard';
import { normalisePhone } from '@/lib/auth/identifier';
import { issueOtp, OtpPurpose } from '@/lib/auth/otp';
import { consumeAll, OTP_LIMITS } from '@/lib/auth/rate-limit';
import { phoneStartSchema } from '@/lib/auth/schemas';
import { db } from '@/lib/db';
import {
  clientIp,
  errorJson,
  json,
  parseBody,
  requireSameOrigin,
  serverError,
} from '@/lib/http';
import { sendOtp } from '@/lib/notify';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // CSRF: reject a cross-origin state change (Phase 7 §7 SECURITY).
  const crossOrigin = await requireSameOrigin();
  if (crossOrigin) return crossOrigin;

  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof UnauthorisedError) return errorJson('Sign in first.', 401);
    throw err;
  }

  // Without a verified email there is nowhere safe to send the code.
  if (!user.email || !user.emailVerified) {
    return errorJson('Verify your email address first.', 409);
  }

  const parsed = await parseBody(request, phoneStartSchema);
  if (!parsed.ok) return parsed.response;

  // E.164 before anything touches the database (§3.4).
  const phone = normalisePhone(parsed.data.phone);
  if (!phone) return errorJson('Enter a valid Indian mobile number.', 400);

  const taken = await db.user.findUnique({ where: { phone }, select: { id: true } });
  if (taken && taken.id !== user.id) {
    return errorJson('That number is already linked to another account.', 409);
  }

  const ip = await clientIp();
  const limit = await consumeAll([
    OTP_LIMITS.sendPerIdentifier(user.email),
    OTP_LIMITS.sendPerIp(ip),
  ]);
  if (!limit.allowed) {
    return errorJson('Too many requests. Try again shortly.', 429, {
      retryAfter: limit.retryAfter,
    });
  }

  try {
    /**
     * The OTP identifier is the EMAIL, not the phone.
     *
     * This matters: it binds the code to the mailbox it was sent to, so a code obtained
     * for one purpose cannot be replayed against a different number, and it keeps
     * CLAIM_ORDER (which is keyed by phone) permanently distinct from this flow.
     */
    const { code } = await issueOtp(user.email, OtpPurpose.ADD_PHONE, Channel.EMAIL);
    await sendOtp(Channel.EMAIL, user.email, code);

    return json({
      sent: true,
      // Shown so the customer is not left staring at their phone waiting for an SMS.
      sentTo: 'email',
      message: `We sent a code to ${user.email}.`,
    });
  } catch (err) {
    return serverError(err, 'phone/start');
  }
}
