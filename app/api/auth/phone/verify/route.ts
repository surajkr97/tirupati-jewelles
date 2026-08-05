/**
 * POST /api/auth/phone/verify — attach the number to the account. [authed]
 * Created by Phase 3 (specs/03-auth.md §3.4), revised for email-only delivery (D-011).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THIS ROUTE DELIBERATELY DOES NOT CLAIM ORDERS.
 *
 *  The code it checks was delivered to the account's EMAIL. That proves control of the
 *  account; it proves nothing about who holds the phone. MASTER-SPEC §5 is explicit:
 *
 *    "The claim runs only after successful OTP verification of that exact number. Never
 *     on an unverified phone field. This is the difference between a feature and an
 *     account-takeover vector."
 *
 *  Claiming here would mean anyone could type a stranger's number and read their entire
 *  purchase history. So this sets `phone` (a login identifier) and leaves `phoneVerified`
 *  FALSE. `claimOrdersForVerifiedPhone` stays gated behind a genuine possession proof —
 *  SMS, or the Phase 8 WhatsApp bill link. See DEBT-011.
 *
 *  If you are here to "make the claim work", add the possession proof. Do not lower this
 *  bar.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { requireUser, UnauthorisedError } from '@/lib/auth/guard';
import { normalisePhone } from '@/lib/auth/identifier';
import { OtpPurpose, verifyOtp } from '@/lib/auth/otp';
import { consumeAll, OTP_LIMITS } from '@/lib/auth/rate-limit';
import { phoneVerifySchema } from '@/lib/auth/schemas';
import { db } from '@/lib/db';
import {
  clientIp,
  errorJson,
  json,
  parseBody,
  requireSameOrigin,
  serverError,
} from '@/lib/http';

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

  if (!user.email || !user.emailVerified) {
    return errorJson('Verify your email address first.', 409);
  }

  const parsed = await parseBody(request, phoneVerifySchema);
  if (!parsed.ok) return parsed.response;

  const phone = normalisePhone(parsed.data.phone);
  if (!phone) return errorJson('Enter a valid Indian mobile number.', 400);

  const ip = await clientIp();
  const limit = await consumeAll([OTP_LIMITS.verifyPerIp(ip)]);
  if (!limit.allowed) {
    return errorJson('Too many attempts. Try again later.', 429, {
      retryAfter: limit.retryAfter,
    });
  }

  try {
    // Keyed by email, matching how /phone/start issued it.
    const verified = await verifyOtp(user.email, OtpPurpose.ADD_PHONE, parsed.data.code);
    if (!verified.ok) {
      const message =
        verified.reason === 'expired' || verified.reason === 'locked'
          ? 'That code has expired. Request a new one.'
          : 'That code is not correct.';
      return errorJson(message, 400, { expired: verified.reason !== 'invalid' });
    }

    // Re-checked after the OTP: another account could have taken the number in between.
    const taken = await db.user.findUnique({ where: { phone }, select: { id: true } });
    if (taken && taken.id !== user.id) {
      return errorJson('That number is already linked to another account.', 409);
    }

    await db.user.update({
      where: { id: user.id },
      // phoneVerified stays false — see the header block. Only a possession proof sets it.
      data: { phone },
    });

    return json({
      saved: true,
      phone,
      message: 'You can now sign in with this number and your password.',
    });
  } catch (err) {
    return serverError(err, 'phone/verify');
  }
}
