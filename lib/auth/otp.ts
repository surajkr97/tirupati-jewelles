/**
 * One-time passcodes.
 * Created by Phase 3 (specs/03-auth.md §3.2).
 *
 * ── Where the OTP lives ──
 * Postgres `OtpCode` is the source of truth; Redis holds only rate-limit counters.
 * MASTER-SPEC §7 lists an `otp:{identifier}:{purpose}` Redis key, but §3.2 requires
 * `attempts` and `consumedAt` semantics that need an atomic conditional update, and
 * MASTER-SPEC §7 also says a Redis outage must never break the site. A Redis-only OTP
 * would evaporate every pending code the moment Redis restarts. See DECISIONS.md D-010.
 *
 * ── Why the pepper matters ──
 * A 6-digit code has a 10^6 keyspace, so a plain SHA-256 digest is trivially reversible by
 * anyone holding a database dump. The pepper — 32+ bytes from `OTP_PEPPER`, held in the
 * environment and never in the database — is what makes the stored digest useless on its
 * own. That is why §3.2 requires `hash(code + OTP_PEPPER)` rather than a bare hash.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { Channel, type PrismaClient } from '@prisma/client';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
/** §3.2: "Max 6 verify attempts, then invalidate and force re-request." */
export const OTP_MAX_ATTEMPTS = 6;

export const OtpPurpose = {
  SIGNUP: 'SIGNUP',
  LOGIN: 'LOGIN',
  CLAIM_ORDER: 'CLAIM_ORDER',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;

export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

/**
 * Cryptographically secure 6-digit code.
 *
 * §3.2: `crypto.randomInt`, never `Math.random` — which is seeded predictably and would
 * let an attacker who observes a few codes derive the rest.
 *
 * Padded rather than range-shifted so every value from 000000 to 999999 is equally likely;
 * generating in [100000, 999999] to avoid padding would silently discard 10% of the space.
 */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(OTP_LENGTH, '0');
}

/** Peppered digest. The pepper never leaves the environment. */
export function hashCode(code: string): string {
  return createHash('sha256').update(`${code}${env.OTP_PEPPER}`).digest('hex');
}

/** Constant-time digest comparison — never `===` on a secret-derived value. */
function digestsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface IssuedOtp {
  code: string;
  expiresAt: Date;
}

/**
 * Issue a code, invalidating every previous one for this identifier+purpose.
 *
 * §3.2: "Requesting a new OTP invalidates all previous ones." Without that, requesting a
 * second code while the first is alive doubles the number of valid guesses.
 *
 * The caller is responsible for rate limiting *before* calling this (see `OTP_LIMITS`) and
 * for delivery afterwards.
 */
export async function issueOtp(
  identifier: string,
  purpose: OtpPurpose,
  channel: Channel,
  client: Pick<PrismaClient, '$transaction'> = db,
): Promise<IssuedOtp> {
  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  await client.$transaction(async (tx) => {
    // Consume rather than delete: the rows are an audit trail of delivery attempts.
    await tx.otpCode.updateMany({
      where: { identifier, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await tx.otpCode.create({
      data: { identifier, purpose, channel, codeHash, expiresAt },
    });
  });

  return { code, expiresAt };
}

export type OtpVerifyResult =
  { ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'locked' | 'not_found' };

/**
 * Verify a submitted code.
 *
 * Every failure mode returns a distinct reason for the *server* to log, but §3.7's UI maps
 * them onto one generic message — the caller must not leak which of these occurred beyond
 * "expired" versus "wrong", or the endpoint becomes an oracle for whether a code exists.
 */
export interface VerifyOptions {
  /**
   * Whether a correct code is burned on success. Default true.
   *
   * The signup flow checks the code twice — once at /signup/verify so the UI can advance
   * to the password step, then again at /signup/complete which actually creates the
   * account. Consuming at the first step would make the second fail, so that call passes
   * `consume: false`.
   *
   * This is not a hole in the single-use rule: a wrong code still increments `attempts`
   * either way, so a non-consuming check is not a free oracle, and the code is burned at
   * the step that has an effect.
   */
  consume?: boolean;
}

export async function verifyOtp(
  identifier: string,
  purpose: OtpPurpose,
  code: string,
  options: VerifyOptions = {},
): Promise<OtpVerifyResult> {
  const { consume = true } = options;
  const record = await db.otpCode.findFirst({
    where: { identifier, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) return { ok: false, reason: 'not_found' };

  if (record.expiresAt.getTime() <= Date.now()) {
    await db.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await db.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return { ok: false, reason: 'locked' };
  }

  if (!digestsMatch(hashCode(code), record.codeHash)) {
    const updated = await db.otpCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });

    // Burn the code on the attempt that reaches the cap, so the 7th try finds nothing.
    if (updated.attempts >= OTP_MAX_ATTEMPTS) {
      await db.otpCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return { ok: false, reason: 'locked' };
    }

    return { ok: false, reason: 'invalid' };
  }

  if (!consume) return { ok: true };

  /**
   * Consume atomically.
   *
   * The `consumedAt: null` predicate is the concurrency guard: two simultaneous requests
   * with the same correct code both reach here, but `updateMany` reports how many rows it
   * actually changed, so exactly one sees `count === 1` and wins. Reading-then-writing
   * would let both succeed.
   */
  const consumed = await db.otpCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  if (consumed.count !== 1) return { ok: false, reason: 'invalid' };

  return { ok: true };
}

/** Housekeeping. Phase 9 §9.3 moves this onto Celery. */
export async function purgeExpiredOtps(olderThan: Date = new Date()): Promise<number> {
  const { count } = await db.otpCode.deleteMany({
    where: { expiresAt: { lt: olderThan } },
  });
  return count;
}

export { Channel };
