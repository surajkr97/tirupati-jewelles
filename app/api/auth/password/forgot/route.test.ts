/**
 * Phase 9 §9.5 — POST /api/auth/password/forgot must not change its answer when a delivery
 * channel is unavailable.
 *
 * ── The defect these tests were written against ──
 * The route picked `Channel.SMS` whenever the identifier looked like a phone number. There
 * is no SMS provider (D-011) and `SmsNotifier.send` throws, so:
 *
 *   registered phone   → the send ran, threw, and `serverError` answered **500**
 *   unregistered phone → no send, no throw, the generic **200**
 *
 * Which is an unauthenticated account-existence oracle over the customer list, keyed by
 * phone number — the exact enumeration issue §3 and AGENTS.md's risk table forbid — plus a
 * password-reset flow that simply did not work for anyone who typed their number. Found by
 * `pnpm verify:degradation`, not by review, because both halves only appear when the SMS
 * channel is exercised end to end and nothing had ever done that.
 *
 * ── Mutation-checked, and the result is worth stating precisely ──
 * Three of these five fail against the pre-fix route: the two that assert the delivery
 * channel, and the provider-outage one. The other two — "answers 200" and "a registered and
 * an unregistered phone get the same answer" — PASS against the broken code, because
 * `@/lib/notify` is mocked here, so the SMS stub that produced the 500 never runs.
 *
 * That is not a weakness to hide; it is the reason `verify-degradation.mts` exists. A unit
 * test with the failing dependency stubbed out cannot see a fault whose whole nature is that
 * the dependency is unavailable. The oracle was found against a running server with the real
 * notifier, and it is reproduced here only by making the mock throw.
 */
import { Channel } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Records what the notifier was asked to do, and can be made to fail like a real outage. */
const notify = vi.hoisted(() => ({
  sent: [] as { channel: string; to: string; code: string }[],
  failWith: null as Error | null,
}));

vi.mock('@/lib/notify', () => ({
  sendOtp: vi.fn(async (channel: string, to: string, code: string) => {
    if (notify.failWith) throw notify.failWith;
    notify.sent.push({ channel, to, code });
    return { delivered: true };
  }),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.44' }),
}));

import { POST } from '@/app/api/auth/password/forgot/route';
import { OtpPurpose } from '@/lib/auth/otp';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';

const PHONE = '+919999900044';
const EMAIL = 'forgot-degradation@example.com';

function request(identifier: string): Request {
  return new Request('http://localhost:3000/api/auth/password/forgot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
}

/**
 * The rate limiter is per-identifier and fails closed, so without this the second test in
 * the file gets a 429 and every assertion below becomes meaningless.
 */
async function clearLimits(): Promise<void> {
  const keys = await redis.keys('rl:otp:send:*');
  if (keys.length) await redis.del(...keys);
}

beforeEach(async () => {
  notify.sent = [];
  notify.failWith = null;

  await db.otpCode.deleteMany({ where: { identifier: { in: [PHONE, EMAIL] } } });
  await db.user.deleteMany({ where: { OR: [{ phone: PHONE }, { email: EMAIL }] } });
  await db.user.create({ data: { phone: PHONE, email: EMAIL, passwordHash: 'x' } });
  await clearLimits();
});

afterAll(async () => {
  await db.otpCode.deleteMany({ where: { identifier: { in: [PHONE, EMAIL] } } });
  await db.user.deleteMany({ where: { OR: [{ phone: PHONE }, { email: EMAIL }] } });
  await clearLimits();
});

describe('the SMS channel is unavailable, and reset by phone still works', () => {
  it('answers 200 for a registered phone number', async () => {
    const response = await POST(request(PHONE));
    expect(response.status).toBe(200);
  });

  it('delivers the code by EMAIL, never over the SMS stub', async () => {
    await POST(request(PHONE));

    expect(notify.sent).toHaveLength(1);
    expect(notify.sent[0]?.channel).toBe(Channel.EMAIL);
    expect(notify.sent[0]?.to).toBe(EMAIL);
  });

  it('still keys the OTP on what the customer typed, so the code verifies their number', async () => {
    await POST(request(PHONE));

    const issued = await db.otpCode.findFirst({
      where: { identifier: PHONE, purpose: OtpPurpose.PASSWORD_RESET },
    });
    // Keyed on the phone; delivered to the mailbox. Getting this backwards would send a
    // working code that the reset step then refuses.
    expect(issued).not.toBeNull();
    expect(issued?.channel).toBe(Channel.EMAIL);
  });
});

describe('the response never reveals whether the account exists', () => {
  it('a registered and an unregistered phone get the same status and body', async () => {
    const registered = await POST(request(PHONE));
    const registeredBody = await registered.text();

    await clearLimits();

    const unknown = await POST(request('+919999900045'));
    const unknownBody = await unknown.text();

    expect(registered.status).toBe(unknown.status);
    expect(registeredBody).toBe(unknownBody);
  });

  /**
   * The harder half. A provider outage must not reopen the oracle — and it did, because the
   * send only runs on the branch where the user was found, so only a real account could
   * produce the exception.
   */
  it('a provider outage does not change the answer for a registered account', async () => {
    notify.failWith = new Error('Resend refused the message: service unavailable');

    const outage = await POST(request(PHONE));
    const outageBody = await outage.text();

    await clearLimits();
    notify.failWith = null;

    const healthy = await POST(request('+919999900045'));

    expect(outage.status).toBe(200);
    expect(outage.status).toBe(healthy.status);
    expect(outageBody).toBe(await healthy.text());
  });
});
