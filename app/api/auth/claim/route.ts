/**
 * POST /api/auth/claim — redeem a phone-possession token. [authed]
 * Created by Phase 9 (DEBT-011). Designed in the Phase 8 SECURITY review.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS IS THE ONLY ROUTE THAT MAY REACH `claimOrdersForVerifiedPhone`.
 *
 *  MASTER-SPEC §5: "The claim runs only after successful OTP verification of that exact
 *  number. Never on an unverified phone field."
 *
 *  The token stands in for the OTP, and it is equivalent in the only way that matters: it
 *  was delivered TO the number, inside the §8.4 WhatsApp message. Everything else about the
 *  OTP contract is reproduced — hashed at rest, single use enforced by a conditional UPDATE
 *  in Postgres, a TTL, and rate limits per number and per IP that are both consumed on every
 *  attempt so a caller cannot learn which one they tripped.
 *
 *  A POST, not a GET. Redeeming a single-use credential must not happen because a link
 *  preview fetcher, a browser prefetch, or the customer forwarding the message to themselves
 *  touched the URL. The GET at /claim/[token] only looks; this is what acts.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod';

import { claimOrdersForVerifiedPhone, PhoneAlreadyVerifiedError } from '@/lib/auth/claim';
import { consumeClaimToken, CLAIM_LIMITS, peekClaimToken } from '@/lib/auth/claim-token';
import { requireUser, UnauthorisedError } from '@/lib/auth/guard';
import { consumeAll } from '@/lib/auth/rate-limit';
import { rotateSession } from '@/lib/auth/session';
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

const claimSchema = z.object({ token: z.string().min(32).max(128) }).strict();

export async function POST(request: Request) {
  const crossOrigin = await requireSameOrigin();
  if (crossOrigin) return crossOrigin;

  /**
   * Signed in first.
   *
   * The token proves who holds the NUMBER; the session proves which ACCOUNT the purchases
   * should attach to. Without both, "claim" has no destination — which is why
   * /claim/[token] sends a signed-out visitor to log in and brings them back.
   */
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof UnauthorisedError) return errorJson('Sign in first.', 401);
    throw err;
  }

  const parsed = await parseBody(request, claimSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const ip = await clientIp();

    /**
     * Peek before the limiter so the per-phone counter can be keyed on the right number.
     *
     * A peek is a read: it consumes nothing and reveals nothing to a caller who does not
     * already hold the token. An unrecognised token still burns the per-IP budget below,
     * which is what bounds a guessing run.
     */
    const looked = await peekClaimToken(parsed.data.token);
    const phoneKey = looked.ok ? looked.phone : `unknown:${ip}`;

    const limit = await consumeAll([
      CLAIM_LIMITS.perIp(ip),
      CLAIM_LIMITS.perPhone(phoneKey),
    ]);
    if (!limit.allowed) {
      return errorJson('Too many attempts. Try again later.', 429, {
        retryAfter: limit.retryAfter,
      });
    }

    if (!looked.ok) {
      // One message for invalid, expired and already-used. Distinguishing them would tell a
      // guesser which tokens exist.
      return errorJson(
        'That link is no longer valid. Ask the shop to resend your bill.',
        400,
      );
    }

    /**
     * Consume and claim in ONE transaction.
     *
     * A token consumed by a claim that then failed would be spent for nothing, and the
     * customer's only copy of it is a WhatsApp message they cannot re-trigger.
     */
    const result = await db.$transaction(async (tx) => {
      const consumed = await consumeClaimToken(parsed.data.token, user.id, tx);
      if (!consumed.ok) return { ok: false as const };

      const claim = await claimOrdersForVerifiedPhone(user.id, consumed.phone, tx);
      return { ok: true as const, phone: consumed.phone, claimed: claim.claimed };
    });

    if (!result.ok) {
      // Lost a race with another tab or a double submit. The other one succeeded.
      return errorJson('That link has already been used.', 409);
    }

    /**
     * §3.3: sessions rotate on a privilege change, and this is one — the account has gone
     * from unverified to holding a proven number, and with it a purchase history.
     */
    await rotateSession({ userId: user.id, role: user.role });

    return json({ claimed: result.claimed, phone: result.phone });
  } catch (err) {
    if (err instanceof PhoneAlreadyVerifiedError) {
      return errorJson(
        'That number is already verified on another account. Please contact the shop.',
        409,
      );
    }
    return serverError(err, 'auth/claim');
  }
}
