/**
 * Phase 8 TEST — dashboard totals, voids, and the flagship claim.
 * specs/08-billing-whatsapp.md:
 *
 *   TEST: "Dashboard totals match direct SQL."
 *   TEST: "Bill for a phone with no account → userId null → user signs up and verifies that
 *          phone → order appears. **The flagship end-to-end test.**"
 *   §8.7: "Exclude voided orders. Cache in Redis 60s; invalidate on new bill."
 *
 * "Match direct SQL" is taken literally: the expected figures come from `$queryRaw`, written
 * independently of the Prisma aggregation the dashboard uses. Two implementations that agree
 * is evidence; one implementation compared against itself is not.
 */
import { Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { claimOrdersForVerifiedPhone, countClaimableOrders } from '@/lib/auth/claim';
import { createBill } from '@/lib/bills/create';
import { createBillSchema } from '@/lib/bills/schema';
import {
  DASHBOARD_TOTALS_KEY,
  getSalesTotals,
  NOT_VOIDED,
  shopStartOfDay,
} from '@/lib/bills/totals';
import { db } from '@/lib/db';
import { RATES_CACHE_KEY } from '@/lib/rates';
import { invalidate } from '@/lib/redis';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const GOLD_22 = 1_184_200n;
const PHONE = '+919876500002';

let adminId: string;

function request(weightGrams: string, phone = PHONE) {
  const parsed = createBillSchema.safeParse({
    customerName: 'Totals',
    customerPhone: phone,
    note: '',
    items: [
      {
        id: 'a',
        productId: null,
        label: 'Chain',
        metal: 'GOLD',
        purity: 'K22_916',
        weightGrams,
        makingPct: '12',
        stoneCharge: '',
        gstPct: '3',
        hallmarkNo: '',
        bisCertNo: '',
      },
    ],
  });
  if (!parsed.success) throw new Error('fixture rejected');
  return parsed.data;
}

/**
 * The dashboard's figures, computed again in SQL by a different route.
 *
 * `::bigint` is load-bearing: Postgres widens `SUM()` over a bigint column to `numeric`,
 * which Prisma hands back as a Decimal — and `expect(13660931n).toBe(Decimal(13660931))`
 * fails on a value that is arithmetically identical. The cast keeps both sides in the one
 * type MASTER-SPEC §4 allows money to be.
 */
async function directSql(where: string) {
  const rows = await db.$queryRawUnsafe<{ total: bigint | null; count: bigint }[]>(
    `SELECT COALESCE(SUM("grandTotal"), 0)::bigint AS total, COUNT(*) AS count
     FROM "Order" WHERE ${where}`,
  );
  const row = rows[0]!;
  return { total: row.total ?? 0n, count: Number(row.count) };
}

describeDb('dashboard totals', () => {
  beforeEach(async () => {
    await db.billPdf.deleteMany();
    await db.orderItem.deleteMany();
    await db.order.deleteMany();
    await db.billSequence.deleteMany();
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY, DASHBOARD_TOTALS_KEY);

    const admin = await db.user.create({
      data: { email: `totals-admin-${Date.now()}@example.com`, role: Role.ADMIN },
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
  }, 30_000);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('matches a direct SQL aggregation', async () => {
    for (const weight of ['10', '20', '5.5']) {
      await createBill(request(weight), { adminId, customerPhone: PHONE });
    }
    await invalidate(DASHBOARD_TOTALS_KEY);

    const totals = await getSalesTotals();
    const sql = await directSql('"voidedAt" IS NULL');

    expect(totals.allTime.total).toBe(sql.total);
    expect(totals.allTime.count).toBe(sql.count);
    // All three were raised today, so today and all-time agree.
    expect(totals.today.total).toBe(sql.total);
    expect(totals.month.total).toBe(sql.total);
  }, 60_000);

  it('excludes a voided order from every period', async () => {
    const first = await createBill(request('10'), { adminId, customerPhone: PHONE });
    const second = await createBill(request('20'), { adminId, customerPhone: PHONE });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    await invalidate(DASHBOARD_TOTALS_KEY);
    const before = await getSalesTotals();
    expect(before.allTime.count).toBe(2);

    await db.order.update({
      where: { id: second.orderId },
      data: {
        voidedAt: new Date(),
        voidReason: 'entered twice',
        voidedByUserId: adminId,
      },
    });
    await invalidate(DASHBOARD_TOTALS_KEY);

    const after = await getSalesTotals();

    expect(after.allTime.count).toBe(1);
    expect(after.allTime.total).toBe(first.grandTotal);
    expect(after.today.total).toBe(first.grandTotal);
    expect(after.month.total).toBe(first.grandTotal);
    expect(after.week.total).toBe(first.grandTotal);
    // And it still exists — §8.5 forbids a hard delete.
    expect(await db.order.count()).toBe(2);
  }, 60_000);

  it('applies the void filter to EVERY aggregate, not just the headline one', async () => {
    // The failure mode this guards: a filter missed on one query makes the shop's month
    // look larger than its year.
    await createBill(request('10'), { adminId, customerPhone: PHONE });
    const voided = await createBill(request('99'), { adminId, customerPhone: PHONE });
    if (!voided.ok) return;

    await db.order.update({
      where: { id: voided.orderId },
      data: { voidedAt: new Date() },
    });
    await invalidate(DASHBOARD_TOTALS_KEY);

    const totals = await getSalesTotals();
    const sql = await directSql('"voidedAt" IS NULL');

    for (const period of [totals.today, totals.week, totals.month, totals.allTime]) {
      expect(period.total).toBe(sql.total);
      expect(period.count).toBe(sql.count);
    }
  }, 60_000);

  it('averages over the unvoided orders only', async () => {
    await createBill(request('10'), { adminId, customerPhone: PHONE });
    await createBill(request('30'), { adminId, customerPhone: PHONE });
    await invalidate(DASHBOARD_TOTALS_KEY);

    const totals = await getSalesTotals();
    expect(totals.averageOrder).toBe(totals.allTime.total / BigInt(totals.allTime.count));
  }, 60_000);

  it('returns zeroes, not NaN, on an empty shop', async () => {
    await invalidate(DASHBOARD_TOTALS_KEY);
    const totals = await getSalesTotals();

    expect(totals.allTime).toEqual({ total: 0n, count: 0 });
    expect(totals.averageOrder).toBe(0n);
  });

  it('counts unsent and unclaimed bills for the alerts', async () => {
    await createBill(request('10'), { adminId, customerPhone: PHONE });
    await invalidate(DASHBOARD_TOTALS_KEY);

    const totals = await getSalesTotals();
    expect(totals.unsent).toBe(1);
    expect(totals.unclaimed).toBe(1);
  }, 30_000);

  it('serves the second read from Redis, and a new bill busts it', async () => {
    // §8.7: "Cache in Redis 60s; invalidate on new bill."
    await createBill(request('10'), { adminId, customerPhone: PHONE });
    await invalidate(DASHBOARD_TOTALS_KEY);

    const first = await getSalesTotals();
    expect(first.allTime.count).toBe(1);

    // Written behind the cache's back. A cached read must NOT see it.
    await db.order.create({
      data: {
        orderNo: 'JW-2026-9999',
        customerPhone: PHONE,
        subtotal: 1n,
        gstAmount: 0n,
        grandTotal: 1n,
        createdByUserId: adminId,
      },
    });

    expect((await getSalesTotals()).allTime.count).toBe(1);

    // `createBill` invalidates, so the next read sees both.
    await createBill(request('10'), { adminId, customerPhone: PHONE });
    expect((await getSalesTotals()).allTime.count).toBe(3);
  }, 60_000);

  it('starts "today" at midnight in the shop’s timezone, not the server’s', async () => {
    // A UTC host's local midnight is 5:30am IST, so "sold today" would drop every sale
    // made before breakfast and include the previous evening's.
    const start = shopStartOfDay(new Date('2026-08-06T02:00:00Z'));
    // 5 Aug 2026, 18:30 UTC === 6 Aug 2026, 00:00 IST.
    expect(start.toISOString()).toBe('2026-08-05T18:30:00.000Z');
  });

  it('exports the void filter as one object, so it cannot be half-applied', () => {
    expect(NOT_VOIDED).toEqual({ voidedAt: null });
  });
});

// ── The flagship (§8 acceptance criterion 4) ───────────────────────────────

describeDb('unclaimed bill → verified phone → order appears', () => {
  beforeEach(async () => {
    await db.billPdf.deleteMany();
    await db.orderItem.deleteMany();
    await db.order.deleteMany();
    await db.billSequence.deleteMany();
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY, DASHBOARD_TOTALS_KEY);

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
  }, 30_000);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('attaches an in-shop purchase to an account created afterwards', async () => {
    /**
     * The whole point of Phase 8, end to end at the data layer.
     *
     * §8's flow: a walk-in customer with no account is billed; later they sign up and prove
     * they hold the number; the purchase appears in their history. The proof step itself
     * cannot run in the product yet (DEBT-011) — `claimOrdersForVerifiedPhone` is called
     * directly here, exactly as the eventual possession check will call it.
     */
    const bill = await createBill(request('10'), { adminId, customerPhone: PHONE });
    expect(bill.ok).toBe(true);
    if (!bill.ok) return;

    // 1. Billed to a number nobody owns.
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: bill.orderId } })).userId,
    ).toBeNull();

    // 2. The customer signs up later, by email, with no phone on the account.
    const customer = await db.user.create({
      data: { email: `walkin-${Date.now()}@example.com`, role: Role.CUSTOMER },
      select: { id: true },
    });

    // Their order history is empty — the state §8.6's prompt exists for.
    expect(await db.order.count({ where: { userId: customer.id } })).toBe(0);
    expect(await countClaimableOrders(PHONE)).toBe(1);

    // 3. They prove they hold the number.
    const result = await claimOrdersForVerifiedPhone(customer.id, PHONE);
    expect(result.claimed).toBe(1);

    // 4. The purchase is in their history, with its figures intact.
    const claimed = await db.order.findMany({
      where: { userId: customer.id },
      select: { id: true, grandTotal: true, billPdfKey: true },
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(bill.orderId);
    expect(claimed[0]!.grandTotal).toBe(bill.grandTotal);
    // And the invoice they were sent is still the one they can download.
    expect(claimed[0]!.billPdfKey).toBeTruthy();

    // The account is now verified, so a FUTURE bill links on its own.
    const next = await createBill(request('20'), { adminId, customerPhone: PHONE });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: next.orderId } })).userId,
    ).toBe(customer.id);
  }, 60_000);

  it('claims every waiting order for that number, not only the newest', async () => {
    await createBill(request('10'), { adminId, customerPhone: PHONE });
    await createBill(request('20'), { adminId, customerPhone: PHONE });
    await createBill(request('30'), { adminId, customerPhone: PHONE });

    const customer = await db.user.create({
      data: { email: `multi-${Date.now()}@example.com` },
      select: { id: true },
    });

    expect((await claimOrdersForVerifiedPhone(customer.id, PHONE)).claimed).toBe(3);
  }, 60_000);

  it('does not hand a stranger someone else’s purchase', async () => {
    const other = '+919876500003';
    await createBill(request('10'), { adminId, customerPhone: PHONE });
    await createBill(request('10', other), { adminId, customerPhone: other });

    const customer = await db.user.create({
      data: { email: `scoped-${Date.now()}@example.com` },
      select: { id: true },
    });

    // Verifying THIS number claims only the bills raised against it.
    expect((await claimOrdersForVerifiedPhone(customer.id, PHONE)).claimed).toBe(1);
    expect(await db.order.count({ where: { userId: customer.id } })).toBe(1);
    expect(await db.order.count({ where: { customerPhone: other, userId: null } })).toBe(
      1,
    );
  }, 60_000);

  it('cannot steal an order already claimed by someone else', async () => {
    await createBill(request('10'), { adminId, customerPhone: PHONE });

    const first = await db.user.create({
      data: { email: `first-${Date.now()}@example.com` },
      select: { id: true },
    });
    await claimOrdersForVerifiedPhone(first.id, PHONE);

    // A second account verifying the same number — a recycled SIM, or an attacker.
    const second = await db.user.create({
      data: { email: `second-${Date.now()}@example.com` },
      select: { id: true },
    });
    // The unique constraint on `phone` means the second claim reassigns the number, but the
    // ALREADY-CLAIMED order must stay with the first account.
    await db.user.update({ where: { id: first.id }, data: { phone: null } });
    expect((await claimOrdersForVerifiedPhone(second.id, PHONE)).claimed).toBe(0);

    expect(await db.order.count({ where: { userId: first.id } })).toBe(1);
    expect(await db.order.count({ where: { userId: second.id } })).toBe(0);
  }, 60_000);
});
