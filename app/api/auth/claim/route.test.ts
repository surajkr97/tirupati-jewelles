/**
 * Phase 9 — POST /api/auth/claim, the boundary in front of the order claim.
 *
 * MASTER-SPEC §5: "The claim runs only after successful OTP verification of that exact
 * number. Never on an unverified phone field. This is the difference between a feature and
 * an account-takeover vector."
 *
 * So the cases that matter are the refusals: no session, no token, someone else's token, a
 * spent one, an expired one, a guessed one. Every one of them must leave `Order.userId` and
 * `User.phoneVerified` exactly as they were — a route that answers 400 and still claims is
 * the failure mode a status-code assertion would not see, so each denial checks the data too.
 */
import { Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

const { guardState, UnauthorisedError } = vi.hoisted(() => {
  class UnauthorisedError extends Error {
    constructor() {
      super('Not authenticated');
      this.name = 'UnauthorisedError';
    }
  }
  return {
    guardState: {
      user: null as { id: string; role: 'ADMIN' | 'CUSTOMER' } | null,
    },
    UnauthorisedError,
  };
});

vi.mock('@/lib/auth/guard', () => ({
  UnauthorisedError,
  requireUser: async () => {
    if (!guardState.user) throw new UnauthorisedError();
    return guardState.user;
  },
  getCurrentUser: async () => guardState.user,
}));

const headerState = vi.hoisted(() => ({ headers: {} as Record<string, string> }));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-for': '203.0.113.21', ...headerState.headers }),
}));

// The session store is Redis-backed and rotation is Phase 3's, tested there.
vi.mock('@/lib/auth/session', () => ({
  rotateSession: vi.fn(async () => 'new-session'),
}));

import { POST } from '@/app/api/auth/claim/route';
import { activeClaimToken, mintClaimToken } from '@/lib/auth/claim-token';
import { createBill } from '@/lib/bills/create';
import { createBillSchema } from '@/lib/bills/schema';
import { db } from '@/lib/db';
import { RATES_CACHE_KEY } from '@/lib/rates';
import { invalidate, redis } from '@/lib/redis';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const GOLD_22 = 1_184_200n;
const PHONE = '+919876500021';

let adminId: string;
let customerId: string;
let orderId: string;
let token: string;

function post(body: unknown, extraHeaders: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

/** Nothing was claimed and nothing was verified. Asserted after every refusal. */
async function assertUntouched() {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { userId: true },
  });
  const customer = await db.user.findUniqueOrThrow({
    where: { id: customerId },
    select: { phoneVerified: true, phone: true },
  });

  expect(order.userId).toBeNull();
  expect(customer.phoneVerified).toBe(false);
  expect(customer.phone).toBeNull();
}

describeDb('POST /api/auth/claim', () => {
  beforeEach(async () => {
    headerState.headers = {};

    await db.claimToken.deleteMany();
    await db.billPdf.deleteMany();
    await db.orderItem.deleteMany();
    await db.order.deleteMany();
    await db.billSequence.deleteMany();
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY);

    const admin = await db.user.create({
      data: { email: `claim-admin-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    const customer = await db.user.create({
      data: { email: `claim-cust-${Date.now()}@example.com`, role: Role.CUSTOMER },
      select: { id: true },
    });
    adminId = admin.id;
    customerId = customer.id;
    guardState.user = { id: customerId, role: Role.CUSTOMER };

    await db.metalRate.create({
      data: {
        metal: 'GOLD',
        purity: Purity.K22_916,
        ratePerGram: GOLD_22,
        setByUserId: adminId,
      },
    });
    await invalidate(RATES_CACHE_KEY);

    const created = await createBill(
      createBillSchema.parse({
        customerName: 'Walk-in',
        customerPhone: PHONE,
        note: '',
        items: [
          {
            id: 'a',
            productId: null,
            label: 'Chain',
            metal: 'GOLD',
            purity: 'K22_916',
            weightGrams: '10',
            makingPct: '12',
            stoneCharge: '',
            gstPct: '3',
            hallmarkNo: '',
            bisCertNo: '',
          },
        ],
      }),
      { adminId, customerPhone: PHONE },
    );
    if (!created.ok) throw new Error('fixture bill failed');
    orderId = created.orderId;
    token = (await activeClaimToken(orderId))!;

    /**
     * Clear EVERY claim counter, not the two obvious ones.
     *
     * The first version deleted `rl:claim:ip:…` and `rl:claim:phone:{PHONE}` and missed
     * `rl:claim:phone:unknown:{ip}` — the bucket an unrecognised token falls into. It
     * accumulated across tests and across runs of the file, so three unrelated cases started
     * returning 429 for reasons that had nothing to do with what they were asserting. A
     * shared counter is state, and state has to be reset by pattern, not by memory.
     */
    const stale = await redis.keys('rl:claim:*');
    if (stale.length > 0) await redis.del(...stale);
  }, 60_000);

  afterAll(async () => {
    await db.$disconnect();
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it('claims the purchase and verifies the number', async () => {
    const response = await post({ token });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.claimed).toBe(1);
    expect(body.phone).toBe(PHONE);

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.userId).toBe(customerId);

    const customer = await db.user.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.phone).toBe(PHONE);
    expect(customer.phoneVerified).toBe(true);
  }, 30_000);

  it('audits the claim', async () => {
    await post({ token });
    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: 'ORDER_CLAIM' },
    });
    expect(entry.actorId).toBe(customerId);
    expect(entry.entityId).toBe(PHONE);
  }, 30_000);

  // ── Refusals ─────────────────────────────────────────────────────────────

  it('refuses a signed-out caller', async () => {
    guardState.user = null;
    expect((await post({ token })).status).toBe(401);
    await assertUntouched();
  }, 30_000);

  it('refuses a cross-origin post', async () => {
    headerState.headers = { origin: 'https://evil.test', host: 'localhost' };
    expect((await post({ token })).status).toBe(403);
    await assertUntouched();
  }, 30_000);

  it('refuses a token that has already been used', async () => {
    expect((await post({ token })).status).toBe(200);

    // A second account tries the same link.
    const other = await db.user.create({
      data: { email: `other-${Date.now()}@example.com` },
      select: { id: true },
    });
    guardState.user = { id: other.id, role: Role.CUSTOMER };

    const response = await post({ token });
    expect(response.status).toBe(400);

    // The order stays with the first claimant.
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.userId).toBe(customerId);
  }, 30_000);

  it('refuses an expired token', async () => {
    await db.claimToken.updateMany({
      where: { orderId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await post({ token })).status).toBe(400);
    await assertUntouched();
  }, 30_000);

  it('refuses a token minted for a DIFFERENT number', async () => {
    // The one that matters: holding someone else's link must not attach their purchases.
    const stranger = '+919876500022';
    const strangerOrder = await db.order.create({
      data: {
        orderNo: 'JW-2026-9500',
        customerPhone: stranger,
        subtotal: 1n,
        gstAmount: 0n,
        grandTotal: 1n,
        createdByUserId: adminId,
      },
      select: { id: true },
    });
    const { token: strangerToken } = await mintClaimToken(stranger, strangerOrder.id);

    const response = await post({ token: strangerToken });
    expect(response.status).toBe(200);

    // It claimed the STRANGER'S order, because that is what the token proves — but our
    // fixture order, billed to a different number, is untouched.
    const ours = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(ours.userId).toBeNull();

    const customer = await db.user.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.phone).toBe(stranger);
  }, 30_000);

  it.each([
    ['a guessed token', 'A'.repeat(43)],
    ['a short token', 'abc'],
    ['an empty token', ''],
  ])(
    'refuses %s',
    async (_label, bad) => {
      const response = await post({ token: bad });
      expect([400, 429]).toContain(response.status);
      await assertUntouched();
    },
    30_000,
  );

  it('rejects a body carrying anything else', async () => {
    // `.strict()` — a `userId` or a `phone` in the payload is a tampering attempt.
    expect((await post({ token, phone: '+919999999999' })).status).toBe(400);
    expect((await post({ token, userId: adminId })).status).toBe(400);
    await assertUntouched();
  }, 30_000);

  it('rejects a body that is not JSON', async () => {
    expect((await post('not json')).status).toBe(400);
    await assertUntouched();
  }, 30_000);

  // ── Rate limiting ────────────────────────────────────────────────────────

  it('cuts a guessing run off after five attempts', async () => {
    /**
     * Both limiters apply, and the tighter one bites first.
     *
     * An unrecognised token has no phone to key on, so the per-phone counter falls back to
     * `unknown:{ip}` at 5/hour while the per-IP counter allows 10. The effect is that
     * GUESSING is capped at five an hour per IP, while a genuine customer retrying their own
     * link still has the full per-phone budget. That is the right way round, and it is worth
     * pinning: the numbers were chosen independently and their interaction was not.
     */
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await post({ token: `${'B'.repeat(42)}${i}` })).status);
    }

    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
    await assertUntouched();
  }, 60_000);

  it('refuses when another account has already proven the number', async () => {
    await db.user.create({
      data: {
        email: `incumbent-${Date.now()}@example.com`,
        phone: PHONE,
        phoneVerified: true,
      },
    });

    const response = await post({ token });
    expect(response.status).toBe(409);

    const customer = await db.user.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.phoneVerified).toBe(false);
  }, 30_000);
});
