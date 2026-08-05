/**
 * POST /api/auth/signup/verify — check the emailed code without burning it.
 * Created by Phase 3 (specs/03-auth.md §3.4).
 *
 * This step only lets the UI advance to the password screen. `/signup/complete` re-checks
 * the same code and consumes it there, at the step that actually creates the account —
 * see `VerifyOptions` in lib/auth/otp.ts. A wrong code still burns an attempt here, so
 * this is not a free guessing oracle.
 */
import { OtpPurpose, verifyOtp } from '@/lib/auth/otp';
import { consumeAll, OTP_LIMITS } from '@/lib/auth/rate-limit';
import { signupVerifySchema } from '@/lib/auth/schemas';
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

  const parsed = await parseBody(request, signupVerifySchema);
  if (!parsed.ok) return parsed.response;

  const { email, code } = parsed.data;
  const ip = await clientIp();

  const limit = await consumeAll([OTP_LIMITS.verifyPerIp(ip)]);
  if (!limit.allowed) {
    return errorJson('Too many attempts. Try again later.', 429, {
      retryAfter: limit.retryAfter,
    });
  }

  try {
    const result = await verifyOtp(email, OtpPurpose.SIGNUP, code, { consume: false });

    if (!result.ok) {
      // "expired" and "locked" are actionable — the user must request a new code, and
      // hiding that produces a dead end. Everything else collapses to one message.
      const message =
        result.reason === 'expired' || result.reason === 'locked'
          ? 'That code has expired. Request a new one.'
          : 'That code is not correct.';
      return errorJson(message, 400, { expired: result.reason !== 'invalid' });
    }

    return json({ verified: true });
  } catch (err) {
    return serverError(err, 'signup/verify');
  }
}
