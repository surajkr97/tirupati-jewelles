/**
 * POST /api/auth/phone/start — send an OTP to the caller's phone. [authed]
 * Created by Phase 3 (specs/03-auth.md §3.4).
 */
import { Channel } from '@prisma/client';

import { requireUser, UnauthorisedError } from '@/lib/auth/guard';
import { normalisePhone } from '@/lib/auth/identifier';
import { issueOtp, OtpPurpose } from '@/lib/auth/otp';
import { consumeAll, OTP_LIMITS } from '@/lib/auth/rate-limit';
import { phoneStartSchema } from '@/lib/auth/schemas';
import { clientIp, errorJson, json, parseBody, serverError } from '@/lib/http';
import { sendOtp } from '@/lib/notify';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await requireUser();
  } catch (err) {
    if (err instanceof UnauthorisedError) return errorJson('Sign in first.', 401);
    throw err;
  }

  const parsed = await parseBody(request, phoneStartSchema);
  if (!parsed.ok) return parsed.response;

  // E.164 before anything touches the database (§3.4). The claim in /phone/verify matches
  // on this exact string, so a difference in format here silently breaks it.
  const phone = normalisePhone(parsed.data.phone);
  if (!phone) return errorJson('Enter a valid Indian mobile number.', 400);

  const ip = await clientIp();
  const limit = await consumeAll([
    OTP_LIMITS.sendPerIdentifier(phone),
    OTP_LIMITS.sendPerIp(ip),
  ]);
  if (!limit.allowed) {
    return errorJson('Too many requests. Try again shortly.', 429, {
      retryAfter: limit.retryAfter,
    });
  }

  try {
    const { code } = await issueOtp(phone, OtpPurpose.CLAIM_ORDER, Channel.SMS);
    await sendOtp(Channel.SMS, phone, code);
    return json({ sent: true });
  } catch (err) {
    return serverError(err, 'phone/start');
  }
}
