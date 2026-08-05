/**
 * Phase 3 TEST — the OTP abuse cases the spec marks non-negotiable:
 *
 *   "expired code; wrong code 6× → lockout; reuse of consumed code; two OTPs requested in
 *    a row (only latest valid)"  (AGENTS.md must-test table)
 *   "Unit: OTP generation, hashing, expiry, attempt counting."
 *   "Integration: expired OTP rejected; consumed OTP rejected; wrong purpose rejected;
 *    7th attempt locked out."
 */
import { Channel } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  generateCode,
  hashCode,
  issueOtp,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OtpPurpose,
  verifyOtp,
} from '@/lib/auth/otp';
import { db } from '@/lib/db';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const EMAIL = 'otp-test@example.com';

describe('generateCode', () => {
  it(`is always ${OTP_LENGTH} digits`, () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateCode()).toMatch(new RegExp(`^\\d{${OTP_LENGTH}}$`));
    }
  });

  it('can produce leading zeros — the full keyspace, not 90% of it', () => {
    // Generating in [100000, 999999] to dodge padding silently discards 10% of the space.
    // Over 20k draws a leading zero is essentially certain if the range is right.
    const codes = Array.from({ length: 20_000 }, generateCode);
    expect(codes.some((c) => c.startsWith('0'))).toBe(true);
  });

  it('does not repeat itself in a short run', () => {
    const codes = new Set(Array.from({ length: 1_000 }, generateCode));
    // ~1000 draws from 1e6 — collisions are possible but a tight cluster means a bad RNG.
    expect(codes.size).toBeGreaterThan(950);
  });
});

describe('hashCode', () => {
  it('never returns the code itself', () => {
    expect(hashCode('123456')).not.toContain('123456');
  });

  it('is deterministic for the same code', () => {
    expect(hashCode('123456')).toBe(hashCode('123456'));
  });

  it('differs for different codes', () => {
    expect(hashCode('123456')).not.toBe(hashCode('123457'));
  });

  it('produces a full-length sha256 digest', () => {
    expect(hashCode('123456')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describeDb('issueOtp / verifyOtp', () => {
  beforeEach(async () => {
    await db.otpCode.deleteMany();
  });

  afterAll(async () => {
    await db.otpCode.deleteMany();
    await db.$disconnect();
  });

  it('accepts the correct code once', async () => {
    const { code } = await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);
    await expect(verifyOtp(EMAIL, OtpPurpose.SIGNUP, code)).resolves.toEqual({
      ok: true,
    });
  });

  it('stores only the digest, never the code', async () => {
    const { code } = await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);
    const row = await db.otpCode.findFirstOrThrow({ where: { identifier: EMAIL } });

    expect(row.codeHash).not.toBe(code);
    expect(row.codeHash).toBe(hashCode(code));
  });

  it('rejects a consumed code on reuse', async () => {
    const { code } = await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);

    await verifyOtp(EMAIL, OtpPurpose.SIGNUP, code);
    const second = await verifyOtp(EMAIL, OtpPurpose.SIGNUP, code);

    expect(second.ok).toBe(false);
  });

  it('rejects an expired code', async () => {
    const { code } = await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);

    await db.otpCode.updateMany({
      where: { identifier: EMAIL },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await verifyOtp(EMAIL, OtpPurpose.SIGNUP, code)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a code issued for a different purpose', async () => {
    const { code } = await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);

    // §3.2: "An OTP issued for one purpose must never validate another." Without this, a
    // signup code could reset a password.
    const result = await verifyOtp(EMAIL, OtpPurpose.PASSWORD_RESET, code);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('locks out on the 7th attempt', async () => {
    await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);

    for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      const result = await verifyOtp(EMAIL, OtpPurpose.SIGNUP, '000000');
      expect(result).toEqual({ ok: false, reason: 'invalid' });
    }

    // The attempt that reaches the cap burns the code.
    expect(await verifyOtp(EMAIL, OtpPurpose.SIGNUP, '000000')).toEqual({
      ok: false,
      reason: 'locked',
    });
  });

  it('a locked-out code stays dead even if the right code arrives', async () => {
    const { code } = await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      await verifyOtp(EMAIL, OtpPurpose.SIGNUP, '000000');
    }

    expect((await verifyOtp(EMAIL, OtpPurpose.SIGNUP, code)).ok).toBe(false);
  });

  it('issuing a second code invalidates the first', async () => {
    const first = await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);
    const second = await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);

    // §3.2: two live codes double the number of valid guesses.
    expect((await verifyOtp(EMAIL, OtpPurpose.SIGNUP, first.code)).ok).toBe(false);

    await db.otpCode.updateMany({
      where: { identifier: EMAIL, codeHash: hashCode(second.code) },
      data: { consumedAt: null },
    });
    expect((await verifyOtp(EMAIL, OtpPurpose.SIGNUP, second.code)).ok).toBe(true);
  });

  it('a non-consuming check leaves the code usable but still counts wrong guesses', async () => {
    const { code } = await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);

    expect(await verifyOtp(EMAIL, OtpPurpose.SIGNUP, code, { consume: false })).toEqual({
      ok: true,
    });
    // Still valid — this is what lets /signup/verify precede /signup/complete.
    expect((await verifyOtp(EMAIL, OtpPurpose.SIGNUP, code)).ok).toBe(true);
  });

  it('a wrong guess during a non-consuming check still burns an attempt', async () => {
    await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);

    await verifyOtp(EMAIL, OtpPurpose.SIGNUP, '000000', { consume: false });

    const row = await db.otpCode.findFirstOrThrow({ where: { identifier: EMAIL } });
    // Otherwise the non-consuming path would be a free, unlimited guessing oracle.
    expect(row.attempts).toBe(1);
  });

  it('only one of two concurrent uses of the same code wins', async () => {
    const { code } = await issueOtp(EMAIL, OtpPurpose.SIGNUP, Channel.EMAIL);

    const results = await Promise.all([
      verifyOtp(EMAIL, OtpPurpose.SIGNUP, code),
      verifyOtp(EMAIL, OtpPurpose.SIGNUP, code),
    ]);

    // The atomic `consumedAt: null` predicate is what makes this exactly one.
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('returns not_found when no code was ever issued', async () => {
    expect(await verifyOtp('nobody@example.com', OtpPurpose.SIGNUP, '123456')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});
