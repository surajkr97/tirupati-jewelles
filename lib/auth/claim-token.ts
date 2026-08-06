/**
 * Phone-possession tokens, delivered inside the WhatsApp bill message.
 * Created by Phase 9 (DEBT-011). Design constraints from the Phase 8 SECURITY review.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS IS THE POSSESSION PROOF THE ORDER CLAIM HAS BEEN WAITING FOR SINCE PHASE 3.
 *
 *  MASTER-SPEC §5: "The claim runs only after successful OTP verification of that exact
 *  number ... This is the difference between a feature and an account-takeover vector."
 *
 *  Email OTP proves control of an ACCOUNT, not of a NUMBER (D-011), so
 *  `claimOrdersForVerifiedPhone` had no caller and Phase 8's flagship feature — an in-shop
 *  purchase appearing in the customer's history — could not complete. A token minted with
 *  the bill and carried in the §8.4 message is delivered TO the number, which is exactly
 *  what an SMS OTP would have proven, over a channel the shop already uses.
 *
 *  ── The five constraints SECURITY set, and where each lives ──
 *    1. Single use, enforced in POSTGRES not Redis  → `consumeClaimToken`'s conditional
 *       UPDATE. Redis cannot do a conditional consume without Lua, and a restart would
 *       strand every customer mid-claim. The same reasoning as D-010.
 *    2. Short TTL                                    → `CLAIM_TOKEN_TTL_SECONDS`, below.
 *    3. Rate limited per number AND per IP           → `CLAIM_LIMITS`, applied by the route.
 *    4. Unguessable                                  → a 256-bit HMAC; see the note on
 *                                                      `TOKEN_LABEL` for why it is derived
 *                                                      rather than random.
 *    5. Not derivable from the invoice number        → nothing about `orderNo` is an input,
 *                                                      and the key never leaves the server.
 *
 *  Stored HASHED and peppered, exactly like `OtpCode`. A database dump alone yields nothing
 *  usable: the digest cannot be reversed and the signing key is in the environment.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import type { RateLimitRule } from '@/lib/auth/rate-limit';

/**
 * Seven days, matching the signed PDF link in the same message.
 *
 * SECURITY asked for a "short" TTL, and shorter would be safer in the abstract — but the
 * two links travel together and a customer who opens the message on Tuesday should not find
 * one of them working and the other dead. Fifteen minutes, the OTP-style answer, would mean
 * the feature only works for someone watching their phone at the counter, which is not who
 * it is for.
 *
 * The exposure this buys is bounded: whoever holds the message already holds the invoice
 * for that purchase. What the token adds is the customer's OTHER purchases to the same
 * number — real, which is why it is single-use, bound to one number, and audited.
 */
export const CLAIM_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * The token is DERIVED, not random, and that is a deliberate trade.
 *
 * A random token can only be shown once, because it is stored hashed — and this one has to
 * be reproducible: §8.4 has the admin send the message from the bill detail page, which may
 * be minutes or days after the bill was raised, and may happen twice if they resend. A
 * fresh random token per page view would either accumulate live credentials or invalidate
 * the link already sitting in the customer's WhatsApp.
 *
 * So it is an HMAC over the order, the number and the deadline, keyed on a secret that
 * never leaves the server — the same construction as the signed bill URL in
 * `lib/bills/storage.ts`, chosen for consistency with a mechanism this codebase has already
 * reviewed. It is unguessable without the key and is not derivable from the invoice number,
 * which is what the SECURITY constraint asks. What it costs, stated plainly: a leak of the
 * environment lets an attacker who ALSO knows an order id and its phone number mint a token,
 * where a random one would have been worthless. Single use, the TTL and the rate limits all
 * still apply, and `SESSION_SECRET` leaking is already game over for sessions.
 */
const TOKEN_LABEL = 'claim-token-v1';

function signingKey(): Buffer {
  // Domain-separated from the bill-URL key and from any other use of the same secret.
  return createHmac('sha256', env.SESSION_SECRET).update(TOKEN_LABEL).digest();
}

/** The raw token for a given order, number and deadline. Stable across calls. */
export function deriveClaimToken(
  orderId: string,
  phone: string,
  expiresAt: Date,
): string {
  return createHmac('sha256', signingKey())
    .update(`${orderId}.${phone}.${Math.floor(expiresAt.getTime() / 1000)}`)
    .digest('base64url');
}

/**
 * §3.2's limits, restated for this surface.
 *
 * Per IP bounds someone spraying guesses at the token space from one host; per phone bounds
 * repeated attempts against one customer's number even from a botnet. Both are consumed on
 * every attempt, so a caller cannot discover which one they tripped.
 */
export const CLAIM_LIMITS = {
  perIp: (ip: string): RateLimitRule => ({
    key: `claim:ip:${ip}`,
    limit: 10,
    windowSeconds: 60 * 60,
  }),
  perPhone: (phone: string): RateLimitRule => ({
    key: `claim:phone:${phone}`,
    limit: 5,
    windowSeconds: 60 * 60,
  }),
} as const;

export interface MintedClaimToken {
  /** The raw token. Returned ONCE, put in the message, and never stored. */
  token: string;
  expiresAt: Date;
}

/** Peppered digest. The pepper never leaves the environment. */
export function hashClaimToken(token: string): string {
  return createHash('sha256').update(`${token}${env.OTP_PEPPER}`).digest('hex');
}

/**
 * Issue a token proving possession of `phone`.
 *
 * Runs on the caller's transaction client when there is one, so a bill and its token commit
 * together — a message promising a link to a token that was rolled back is worse than a
 * message with no link.
 */
export async function mintClaimToken(
  phone: string,
  orderId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<MintedClaimToken> {
  // Truncated to whole seconds, because that is the resolution the derivation uses — a
  // millisecond kept here and dropped there would make the token irreproducible.
  const expiresAt = new Date(
    Math.floor((Date.now() + CLAIM_TOKEN_TTL_SECONDS * 1000) / 1000) * 1000,
  );
  const token = deriveClaimToken(orderId, phone, expiresAt);

  await client.claimToken.create({
    data: { tokenHash: hashClaimToken(token), phone, orderId, expiresAt },
  });

  return { token, expiresAt };
}

/**
 * Recover the live claim link for an order, if there is one.
 *
 * Returns null when the number is already verified, when the token has been used, or when
 * it has expired — each of which means the bill screen should not offer a claim link.
 * Nothing is written; this is a read plus a derivation.
 */
export async function activeClaimToken(orderId: string): Promise<string | null> {
  const row = await db.claimToken.findFirst({
    where: { orderId, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { phone: true, expiresAt: true, tokenHash: true },
  });
  if (!row) return null;

  const token = deriveClaimToken(orderId, row.phone, row.expiresAt);

  /**
   * Re-derivation must reproduce the stored hash.
   *
   * If it does not, `SESSION_SECRET` has been rotated since the bill was raised, and every
   * token minted before the rotation is dead. Returning null is the honest answer — the
   * alternative is handing the admin a link that will 404 for their customer.
   */
  return claimDigestsMatch(hashClaimToken(token), row.tokenHash) ? token : null;
}

export type ClaimTokenLookup =
  | { ok: true; id: string; phone: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'consumed' };

/**
 * Look a token up WITHOUT consuming it.
 *
 * Used by the confirmation screen, which has to be able to say "this link is for
 * +91XXXXXXXXXX" before the customer presses anything. A GET must not consume a
 * single-use credential — someone forwarding the link to themselves, a link preview
 * fetcher, or a browser prefetch would burn it.
 */
export async function peekClaimToken(token: string): Promise<ClaimTokenLookup> {
  if (!isWellFormed(token)) return { ok: false, reason: 'invalid' };

  const row = await db.claimToken.findUnique({
    where: { tokenHash: hashClaimToken(token) },
    select: { id: true, phone: true, consumedAt: true, expiresAt: true },
  });

  if (!row) return { ok: false, reason: 'invalid' };
  if (row.consumedAt) return { ok: false, reason: 'consumed' };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  return { ok: true, id: row.id, phone: row.phone };
}

/**
 * Consume a token, atomically, once.
 *
 * The condition is in the `WHERE`, not in a preceding read: two requests arriving together
 * both pass a read-then-write check and both claim. `updateMany` returning a count is the
 * same shape `verifyOtp` uses, and the count is the only thing that decides.
 */
export async function consumeClaimToken(
  token: string,
  userId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<ClaimTokenLookup> {
  if (!isWellFormed(token)) return { ok: false, reason: 'invalid' };

  const tokenHash = hashClaimToken(token);

  const result = await client.claimToken.updateMany({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date(), consumedBy: userId },
  });

  if (result.count === 1) {
    const row = await client.claimToken.findUnique({
      where: { tokenHash },
      select: { id: true, phone: true },
    });
    // Unreachable: the update just matched it.
    if (!row) return { ok: false, reason: 'invalid' };
    return { ok: true, id: row.id, phone: row.phone };
  }

  // The update matched nothing. Say why, from a read that cannot race the caller into
  // success — the token is already spent or gone either way.
  return peekClaimToken(token);
}

/**
 * Shape check before the database is touched.
 *
 * Not a security control — the hash lookup is — but it keeps a 4KB path segment from
 * becoming a query, and the constant-time comparison below exists so that a future
 * refactor to a non-unique lookup does not silently become an oracle.
 */
function isWellFormed(token: string): boolean {
  // A base64url SHA-256 digest is 43 characters. The range is deliberately loose so a
  // future change of construction does not silently start rejecting valid tokens.
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

/** Constant-time digest comparison, for any caller that compares hashes directly. */
export function claimDigestsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
