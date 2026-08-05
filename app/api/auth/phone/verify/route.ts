/**
 * POST /api/auth/phone/verify — verify ownership, then claim matching orders. [authed]
 * Created by Phase 3 (specs/03-auth.md §3.4, §3.5).
 *
 * This is the phase's flagship path and its sharpest edge. MASTER-SPEC §5:
 *
 *   "The claim runs only after successful OTP verification of that exact number. Never on
 *    an unverified phone field. This is the difference between a feature and an
 *    account-takeover vector."
 *
 * The ordering below is the security property: verify FIRST, claim SECOND, and never claim
 * a number other than the one just proven. Any refactor that hoists the claim above the
 * verification, or takes the phone from anywhere but this validated body, reintroduces the
 * vulnerability.
 */
import { claimOrdersForVerifiedPhone } from '@/lib/auth/claim';
import { requireUser, UnauthorisedError } from '@/lib/auth/guard';
import { normalisePhone } from '@/lib/auth/identifier';
import { OtpPurpose, verifyOtp } from '@/lib/auth/otp';
import { consumeAll, OTP_LIMITS } from '@/lib/auth/rate-limit';
import { phoneVerifySchema } from '@/lib/auth/schemas';
import { db } from '@/lib/db';
import { clientIp, errorJson, json, parseBody, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (err) {
    if (err instanceof UnauthorisedError) return errorJson('Sign in first.', 401);
    throw err;
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
    /**
     * Another account already owns this number, verified.
     *
     * Checked before the OTP so a second account cannot take a verified number off the
     * first by intercepting one SMS — the number is a claim key for purchase history, so
     * transferring it silently would hand over someone's order history.
     */
    const takenBy = await db.user.findUnique({
      where: { phone },
      select: { id: true, phoneVerified: true },
    });
    if (takenBy && takenBy.id !== userId && takenBy.phoneVerified) {
      return errorJson('That number is already linked to another account.', 409);
    }

    // ── 1. Prove ownership. Nothing below runs unless this succeeds. ──
    const verified = await verifyOtp(phone, OtpPurpose.CLAIM_ORDER, parsed.data.code);
    if (!verified.ok) {
      const message =
        verified.reason === 'expired' || verified.reason === 'locked'
          ? 'That code has expired. Request a new one.'
          : 'That code is not correct.';
      return errorJson(message, 400, { expired: verified.reason !== 'invalid' });
    }

    // ── 2. Only now: mark verified and attach matching unclaimed orders. ──
    const { claimed } = await claimOrdersForVerifiedPhone(userId, phone);

    return json({
      verified: true,
      claimed,
      // §3.5 wants the UI to be able to say "We found 3 past purchases linked to this
      // number" — a genuinely good moment for the customer.
      message:
        claimed > 0
          ? `We found ${claimed} past purchase${claimed === 1 ? '' : 's'} linked to this number.`
          : 'Your number is verified.',
    });
  } catch (err) {
    return serverError(err, 'phone/verify');
  }
}
