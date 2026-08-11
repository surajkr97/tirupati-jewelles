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
import {
  clientIp,
  errorJson,
  json,
  padTo,
  parseBody,
  requireSameOrigin,
  serverError,
} from '@/lib/http';
import { log } from '@/lib/log';
import { sendOtp } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/**
 * Send the code, and never let a delivery failure change the response — Phase 9 §9.5.
 *
 * This is deliberately not the codebase's usual "let it throw and return 500". The response
 * of this endpoint is a SECURITY property: §3 requires the same answer for an account that
 * exists and one that does not, and the send only runs on the branch where the account was
 * found. So any exception escaping from delivery — the SMS stub, a Resend outage, an expired
 * API key — converts this endpoint into an account-existence oracle at exactly the moment
 * the provider is unhealthy.
 *
 * Nothing is swallowed: the error is logged at `error` level (redacted, DEBT-036) and
 * reaches Sentry through the same pipe as any other, so the outage is visible to whoever is
 * on call. What does not happen is the customer, or an attacker, learning about it.
 *
 * The cost, stated: a customer whose email genuinely failed to send is told a code is on its
 * way and never receives one. That is the better failure — they can retry, and the alternative
 * leaks the customer list.
 */
async function deliver(email: string, code: string): Promise<void> {
  try {
    await sendOtp(Channel.EMAIL, email, code, 'reset');
  } catch (err) {
    log.error('password/forgot delivery failed', { error: String(err) });
  }
}

export async function POST(request: Request) {
  // CSRF: reject a cross-origin state change (Phase 7 §7 SECURITY).
  const crossOrigin = await requireSameOrigin();
  if (crossOrigin) return crossOrigin;

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
        select: { id: true, email: true },
      });

      /**
       * Delivery goes to the account's EMAIL whatever the customer typed — Phase 9 §9.5.
       *
       * ── The bug this replaces, found by killing the dependency ──
       * This branch used to pick `Channel.SMS` whenever the identifier was a phone number.
       * There is no SMS provider (D-011) and `SmsNotifier.send` throws, so a customer
       * resetting their password by phone got a **500**, from a flow that works perfectly
       * by email — and the failure was invisible because nothing had ever exercised the
       * phone branch end to end.
       *
       * It was also an enumeration hole, which is the worse half. §3 requires this endpoint
       * to answer identically whether or not the account exists, and it does — except that
       * the send only happens when the user was FOUND, so the throw only happened for real
       * accounts. A registered number returned 500 and an unregistered one returned 200:
       * an unauthenticated oracle over the customer list, keyed by phone number. Measured
       * by `pnpm verify:degradation`, which reported `500 vs 200` on exactly that pair.
       *
       * `/api/auth/phone/start` has always done it this way (§3.7). This route was the
       * outlier, not the rule.
       *
       * The OTP is still KEYED on what they typed, so the code they receive verifies the
       * identifier they gave. Only the delivery address changes.
       */
      if (user?.email) {
        const { code } = await issueOtp(
          normalised.value,
          OtpPurpose.PASSWORD_RESET,
          Channel.EMAIL,
        );
        await deliver(user.email, code);
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
