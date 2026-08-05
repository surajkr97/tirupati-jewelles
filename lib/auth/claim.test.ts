/**
 * Phase 3 TEST — the flagship of the phase:
 *
 *   "Integration: create an unclaimed order → verify that phone → order appears under the
 *    user. THIS IS THE FLAGSHIP TEST OF THE PHASE."
 *   "Integration: unclaimed order → verify a different phone → order does not attach."
 *
 * MASTER-SPEC §5 states the stakes: the claim is "the difference between a feature and an
 * account-takeover vector". These run against real Postgres because the guarantees under
 * test — transactional updates, the `userId IS NULL` predicate, unique constraints — are
 * database behaviours. A mock would prove only that the mock works.
 */
import { Metal, Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { claimOrdersForVerifiedPhone, countClaimableOrders } from '@/lib/auth/claim';
import { db } from '@/lib/db';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const PHONE_A = '+919876543210';
const PHONE_B = '+919000000001';

let counter = 0;
const uniqueEmail = () => `claim-${Date.now()}-${counter++}@example.com`;

async function makeUser(overrides: { phone?: string; phoneVerified?: boolean } = {}) {
  return db.user.create({
    data: {
      email: uniqueEmail(),
      name: 'Test Customer',
      role: Role.CUSTOMER,
      ...overrides,
    },
    select: { id: true },
  });
}

async function makeUnclaimedOrder(customerPhone: string, createdBy: string) {
  return db.order.create({
    data: {
      orderNo: `JW-TEST-${Date.now()}-${counter++}`,
      customerPhone,
      customerName: 'Walk-in',
      userId: null, // the state a Phase 8 bill leaves behind
      subtotal: 100_000n,
      gstAmount: 3_000n,
      grandTotal: 103_000n,
      createdByUserId: createdBy,
      items: {
        create: {
          name: 'Gold bangle',
          metal: Metal.GOLD,
          purity: Purity.K22_916,
          weightMg: 8_500,
          ratePerGram: 1_184_200n,
          makingPct: '12.00',
          gstPct: '3.00',
          lineTotal: 103_000n,
        },
      },
    },
    select: { id: true },
  });
}

async function wipe() {
  // Order matters: OrderItem cascades from Order, but AuditLog and User do not.
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.auditLog.deleteMany();
  await db.otpCode.deleteMany();
  await db.user.deleteMany();
}

describeDb('order claim on verified phone', () => {
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  it('attaches an unclaimed order once the phone is verified — THE FLAGSHIP CASE', async () => {
    const admin = await makeUser();
    const order = await makeUnclaimedOrder(PHONE_A, admin.id);

    // Before: the bill exists but belongs to nobody.
    const before = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(before.userId).toBeNull();

    // A customer signs up later and proves they own that number.
    const customer = await makeUser();
    const result = await claimOrdersForVerifiedPhone(customer.id, PHONE_A);

    expect(result.claimed).toBe(1);

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.userId).toBe(customer.id);

    const user = await db.user.findUniqueOrThrow({ where: { id: customer.id } });
    expect(user.phone).toBe(PHONE_A);
    expect(user.phoneVerified).toBe(true);
  });

  it('does NOT attach an order billed to a different number', async () => {
    const admin = await makeUser();
    const order = await makeUnclaimedOrder(PHONE_A, admin.id);

    const customer = await makeUser();
    const result = await claimOrdersForVerifiedPhone(customer.id, PHONE_B);

    expect(result.claimed).toBe(0);

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.userId).toBeNull();
  });

  it('claims every matching unclaimed order, not just the newest', async () => {
    const admin = await makeUser();
    await makeUnclaimedOrder(PHONE_A, admin.id);
    await makeUnclaimedOrder(PHONE_A, admin.id);
    await makeUnclaimedOrder(PHONE_A, admin.id);

    const customer = await makeUser();
    expect((await claimOrdersForVerifiedPhone(customer.id, PHONE_A)).claimed).toBe(3);
  });

  it('cannot steal an order already claimed by someone else', async () => {
    const admin = await makeUser();
    const order = await makeUnclaimedOrder(PHONE_A, admin.id);

    const first = await makeUser();
    await claimOrdersForVerifiedPhone(first.id, PHONE_A);

    // Second account verifies the same number — a recycled SIM, or an attacker who got
    // one SMS. The `userId IS NULL` predicate is what stops the transfer.
    const second = await makeUser({ phone: undefined });
    const result = await claimOrdersForVerifiedPhone(second.id, PHONE_A).catch(
      () => null,
    );

    // The unique constraint on User.phone may reject the second write outright; either
    // way the order must still belong to the first claimant.
    if (result) expect(result.claimed).toBe(0);

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.userId).toBe(first.id);
  });

  it('is idempotent — re-verifying claims nothing further', async () => {
    const admin = await makeUser();
    await makeUnclaimedOrder(PHONE_A, admin.id);

    const customer = await makeUser();
    expect((await claimOrdersForVerifiedPhone(customer.id, PHONE_A)).claimed).toBe(1);
    expect((await claimOrdersForVerifiedPhone(customer.id, PHONE_A)).claimed).toBe(0);
  });

  it('writes an AuditLog entry naming the actor and the count', async () => {
    const admin = await makeUser();
    await makeUnclaimedOrder(PHONE_A, admin.id);

    const customer = await makeUser();
    await claimOrdersForVerifiedPhone(customer.id, PHONE_A);

    const log = await db.auditLog.findFirst({ where: { action: 'ORDER_CLAIM' } });
    expect(log?.actorId).toBe(customer.id);
    expect(log?.entityId).toBe(PHONE_A);
    expect(log?.after).toEqual({ count: 1 });
  });

  it('countClaimableOrders previews without mutating anything', async () => {
    const admin = await makeUser();
    await makeUnclaimedOrder(PHONE_A, admin.id);
    await makeUnclaimedOrder(PHONE_A, admin.id);

    expect(await countClaimableOrders(PHONE_A)).toBe(2);
    expect(await countClaimableOrders(PHONE_B)).toBe(0);

    // Still unclaimed — a preview must not be a claim.
    expect(await db.order.count({ where: { userId: null } })).toBe(2);
  });

  it('an exact-string mismatch claims nothing — why normalisation is load-bearing', async () => {
    const admin = await makeUser();
    // What a bill would contain if someone skipped normalisePhone().
    await makeUnclaimedOrder('9876543210', admin.id);

    const customer = await makeUser();
    const result = await claimOrdersForVerifiedPhone(customer.id, PHONE_A);

    // Same human number, different string, zero claimed. This is the failure mode
    // lib/auth/identifier.ts exists to prevent.
    expect(result.claimed).toBe(0);
  });
});
