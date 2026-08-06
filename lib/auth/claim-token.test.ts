/**
 * Phase 9 TEST — the phone-possession token (DEBT-011).
 *
 * This is the credential that finally lets `claimOrdersForVerifiedPhone` run, so it is held
 * to the OTP's standard (§3.2, and the Phase 8 SECURITY review):
 *
 *   hashed at rest · single use, atomically · a TTL · rate limited per number and per IP ·
 *   unguessable · not derivable from the invoice number
 *
 * Runs against a real Postgres: single use under concurrency is a conditional-UPDATE
 * behaviour, and a mock would only prove the mock returns what it was told to.
 */
import { Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { claimOrdersForVerifiedPhone, PhoneAlreadyVerifiedError } from '@/lib/auth/claim';
import {
  activeClaimToken,
  CLAIM_TOKEN_TTL_SECONDS,
  consumeClaimToken,
  deriveClaimToken,
  hashClaimToken,
  mintClaimToken,
  peekClaimToken,
} from '@/lib/auth/claim-token';
import { createBill } from '@/lib/bills/create';
import { createBillSchema } from '@/lib/bills/schema';
import { db } from '@/lib/db';
import { RATES_CACHE_KEY } from '@/lib/rates';
import { invalidate } from '@/lib/redis';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const GOLD_22 = 1_184_200n;
const PHONE = '+919876500011';
const OTHER_PHONE = '+919876500012';

let adminId: string;

function bill(phone = PHONE) {
  return createBillSchema.parse({
    customerName: 'Claim Test',
    customerPhone: phone,
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
  });
}

async function reset() {
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
  adminId = admin.id;

  await db.metalRate.create({
    data: {
      metal: 'GOLD',
      purity: Purity.K22_916,
      ratePerGram: GOLD_22,
      setByUserId: adminId,
    },
  });
  await invalidate(RATES_CACHE_KEY);
}

describeDb('claim token', () => {
  beforeEach(reset, 30_000);
  afterAll(async () => {
    await db.$disconnect();
  });

  // ── Storage and shape ────────────────────────────────────────────────────

  it('is never stored in the clear', async () => {
    const order = await db.order.create({
      data: {
        orderNo: 'JW-2026-9001',
        customerPhone: PHONE,
        subtotal: 1n,
        gstAmount: 0n,
        grandTotal: 1n,
        createdByUserId: adminId,
      },
      select: { id: true },
    });

    const { token } = await mintClaimToken(PHONE, order.id);
    const row = await db.claimToken.findFirstOrThrow({ where: { orderId: order.id } });

    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashClaimToken(token));
    // A dump holds a SHA-256 digest and nothing else resembling the credential.
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is url-safe and long enough to be unguessable', async () => {
    const order = await db.order.create({
      data: {
        orderNo: 'JW-2026-9002',
        customerPhone: PHONE,
        subtotal: 1n,
        gstAmount: 0n,
        grandTotal: 1n,
        createdByUserId: adminId,
      },
      select: { id: true },
    });
    const { token } = await mintClaimToken(PHONE, order.id);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // A base64url SHA-256 digest — 256 bits.
    expect(token).toHaveLength(43);
  });

  it('is not derivable from the invoice number', async () => {
    // SECURITY constraint 5. Two bills to the same number differ only by order id, and the
    // tokens must share nothing.
    const first = await createBill(bill(), { adminId, customerPhone: PHONE });
    const second = await createBill(bill(), { adminId, customerPhone: PHONE });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const a = await activeClaimToken(first.orderId);
    const b = await activeClaimToken(second.orderId);

    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    // And neither contains anything from the invoice number.
    expect(a).not.toContain(first.orderNo);
  }, 30_000);

  it('derives the same token for the same inputs, and a different one otherwise', () => {
    const expiry = new Date(1_800_000_000_000);

    expect(deriveClaimToken('order-1', PHONE, expiry)).toBe(
      deriveClaimToken('order-1', PHONE, expiry),
    );
    expect(deriveClaimToken('order-1', PHONE, expiry)).not.toBe(
      deriveClaimToken('order-2', PHONE, expiry),
    );
    expect(deriveClaimToken('order-1', PHONE, expiry)).not.toBe(
      deriveClaimToken('order-1', OTHER_PHONE, expiry),
    );
    expect(deriveClaimToken('order-1', PHONE, expiry)).not.toBe(
      deriveClaimToken('order-1', PHONE, new Date(expiry.getTime() + 1000)),
    );
  });

  // ── Peek does not consume ────────────────────────────────────────────────

  it('peeking does not consume — a link preview must not burn the token', async () => {
    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;
    const token = (await activeClaimToken(created.orderId))!;

    for (let i = 0; i < 5; i += 1) {
      expect((await peekClaimToken(token)).ok).toBe(true);
    }

    const row = await db.claimToken.findFirstOrThrow({
      where: { orderId: created.orderId },
    });
    expect(row.consumedAt).toBeNull();
  }, 30_000);

  // ── Single use ───────────────────────────────────────────────────────────

  it('can be consumed exactly once', async () => {
    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;
    const token = (await activeClaimToken(created.orderId))!;

    const customer = await db.user.create({
      data: { email: `c-${Date.now()}@example.com` },
      select: { id: true },
    });

    expect((await consumeClaimToken(token, customer.id)).ok).toBe(true);

    const second = await consumeClaimToken(token, customer.id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('consumed');
  }, 30_000);

  it('survives a concurrent double-submit — only one caller wins', async () => {
    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;
    const token = (await activeClaimToken(created.orderId))!;

    const customer = await db.user.create({
      data: { email: `race-${Date.now()}@example.com` },
      select: { id: true },
    });

    // A read-then-write check passes in both of these. Only a conditional UPDATE does not.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeClaimToken(token, customer.id)),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  }, 30_000);

  it('records who consumed it', async () => {
    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;
    const token = (await activeClaimToken(created.orderId))!;

    const customer = await db.user.create({
      data: { email: `who-${Date.now()}@example.com` },
      select: { id: true },
    });
    await consumeClaimToken(token, customer.id);

    const row = await db.claimToken.findFirstOrThrow({
      where: { orderId: created.orderId },
    });
    expect(row.consumedBy).toBe(customer.id);
    expect(row.consumedAt).toBeInstanceOf(Date);
  }, 30_000);

  // ── TTL ──────────────────────────────────────────────────────────────────

  it('expires, and an expired token cannot be consumed', async () => {
    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;
    const token = (await activeClaimToken(created.orderId))!;

    await db.claimToken.updateMany({
      where: { orderId: created.orderId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const peeked = await peekClaimToken(token);
    expect(peeked.ok).toBe(false);
    if (!peeked.ok) expect(peeked.reason).toBe('expired');

    const customer = await db.user.create({
      data: { email: `exp-${Date.now()}@example.com` },
      select: { id: true },
    });
    expect((await consumeClaimToken(token, customer.id)).ok).toBe(false);

    // And nothing was marked consumed by the failed attempt.
    const row = await db.claimToken.findFirstOrThrow({
      where: { orderId: created.orderId },
    });
    expect(row.consumedAt).toBeNull();
  }, 30_000);

  it('issues §8.3’s seven-day window, matching the PDF link beside it', async () => {
    expect(CLAIM_TOKEN_TTL_SECONDS).toBe(7 * 24 * 60 * 60);

    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;

    const row = await db.claimToken.findFirstOrThrow({
      where: { orderId: created.orderId },
    });
    const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  }, 30_000);

  // ── Rejections ───────────────────────────────────────────────────────────

  it.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['a path traversal', '../../etc/passwd'],
    ['SQL-ish', "' OR 1=1--"],
    ['a plausible but wrong digest', 'A'.repeat(43)],
  ])('rejects %s', async (_label, token) => {
    const peeked = await peekClaimToken(token);
    expect(peeked.ok).toBe(false);
    if (!peeked.ok) expect(peeked.reason).toBe('invalid');
  });

  // ── Minting rules ────────────────────────────────────────────────────────

  it('mints a token for a bill to an unknown number', async () => {
    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;
    expect(await activeClaimToken(created.orderId)).toBeTruthy();
  }, 30_000);

  it('does NOT mint for a number that is already verified', async () => {
    // The purchase links at creation, so a claim link would be an invitation to do nothing.
    await db.user.create({ data: { phone: PHONE, phoneVerified: true } });

    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;

    expect(await activeClaimToken(created.orderId)).toBeNull();
    expect(await db.claimToken.count({ where: { orderId: created.orderId } })).toBe(0);
  }, 30_000);

  it('stops offering a link once the token is used', async () => {
    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;
    const token = (await activeClaimToken(created.orderId))!;

    const customer = await db.user.create({
      data: { email: `used-${Date.now()}@example.com` },
      select: { id: true },
    });
    await consumeClaimToken(token, customer.id);

    expect(await activeClaimToken(created.orderId)).toBeNull();
  }, 30_000);

  it('hands a resend the SAME link the customer already has', async () => {
    // Re-minting per view would kill the link sitting in their WhatsApp.
    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;

    const first = await activeClaimToken(created.orderId);
    const second = await activeClaimToken(created.orderId);
    expect(first).toBe(second);
    expect(await db.claimToken.count({ where: { orderId: created.orderId } })).toBe(1);
  }, 30_000);

  // ── The flagship, end to end at the data layer ───────────────────────────

  it('turns a walk-in bill into a claimed purchase — DEBT-011 closed', async () => {
    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;

    const token = (await activeClaimToken(created.orderId))!;

    // The customer signs up later, by email, with no phone on the account.
    const customer = await db.user.create({
      data: { email: `walkin-${Date.now()}@example.com` },
      select: { id: true },
    });
    expect(await db.order.count({ where: { userId: customer.id } })).toBe(0);

    // They open the link from WhatsApp and confirm.
    const consumed = await consumeClaimToken(token, customer.id);
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;

    const result = await claimOrdersForVerifiedPhone(customer.id, consumed.phone);
    expect(result.claimed).toBe(1);

    const after = await db.user.findUniqueOrThrow({
      where: { id: customer.id },
      select: { phone: true, phoneVerified: true },
    });
    expect(after.phone).toBe(PHONE);
    expect(after.phoneVerified).toBe(true);
    expect(await db.order.count({ where: { userId: customer.id } })).toBe(1);
  }, 30_000);

  it('detaches an UNVERIFIED holder of the number rather than failing', async () => {
    // The collision this exists for: an abandoned signup left the number on another account.
    const abandoned = await db.user.create({
      data: { email: `abandoned-${Date.now()}@example.com`, phone: PHONE },
      select: { id: true },
    });

    const created = await createBill(bill(), { adminId, customerPhone: PHONE });
    if (!created.ok) return;
    const token = (await activeClaimToken(created.orderId))!;

    const customer = await db.user.create({
      data: { email: `real-${Date.now()}@example.com` },
      select: { id: true },
    });
    const consumed = await consumeClaimToken(token, customer.id);
    if (!consumed.ok) return;

    // Possession beats an assertion nobody checked.
    await expect(
      claimOrdersForVerifiedPhone(customer.id, consumed.phone),
    ).resolves.toMatchObject({ claimed: 1 });

    expect(
      (await db.user.findUniqueOrThrow({ where: { id: abandoned.id } })).phone,
    ).toBeNull();
  }, 30_000);

  it('refuses when another account has already PROVEN the number', async () => {
    // Two people cannot both have proven one number. The first proof stands.
    const first = await db.user.create({
      data: {
        email: `first-${Date.now()}@example.com`,
        phone: PHONE,
        phoneVerified: true,
      },
      select: { id: true },
    });

    const second = await db.user.create({
      data: { email: `second-${Date.now()}@example.com` },
      select: { id: true },
    });

    await expect(claimOrdersForVerifiedPhone(second.id, PHONE)).rejects.toBeInstanceOf(
      PhoneAlreadyVerifiedError,
    );

    // The incumbent is untouched — no silent history transfer.
    const incumbent = await db.user.findUniqueOrThrow({ where: { id: first.id } });
    expect(incumbent.phone).toBe(PHONE);
    expect(incumbent.phoneVerified).toBe(true);
  }, 30_000);

  it('claims only the orders billed to ITS number', async () => {
    await createBill(bill(PHONE), { adminId, customerPhone: PHONE });
    const mine = await createBill(bill(PHONE), { adminId, customerPhone: PHONE });
    await createBill(bill(OTHER_PHONE), { adminId, customerPhone: OTHER_PHONE });
    if (!mine.ok) return;

    const token = (await activeClaimToken(mine.orderId))!;
    const customer = await db.user.create({
      data: { email: `scoped-${Date.now()}@example.com` },
      select: { id: true },
    });

    const consumed = await consumeClaimToken(token, customer.id);
    if (!consumed.ok) return;
    await claimOrdersForVerifiedPhone(customer.id, consumed.phone);

    // Both bills to PHONE, and neither of the ones to OTHER_PHONE.
    expect(await db.order.count({ where: { userId: customer.id } })).toBe(2);
    expect(
      await db.order.count({ where: { customerPhone: OTHER_PHONE, userId: null } }),
    ).toBe(1);
  }, 60_000);
});
