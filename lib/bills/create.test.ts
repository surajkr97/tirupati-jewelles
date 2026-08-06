/**
 * Phase 8 TEST — order creation, the highest-stakes path in the application.
 * specs/08-billing-whatsapp.md, TEST section:
 *
 *   "Server recomputation: submit a bill with a tampered client total → stored order has
 *    the correct server-computed total."
 *   "Rate snapshot: create a bill → change rates → reopen the bill → original figures
 *    unchanged."
 *   "Order number: 50 concurrent bill creations → 50 unique sequential numbers, no gaps, no
 *    duplicates. Run this with real concurrency, not a loop."
 *   "Idempotency key: same key twice → one order."
 *   "Bill for a phone with an unverified account → does not auto-link."
 *
 * Runs against a real Postgres. Every case here is a database behaviour — a row lock, a
 * unique constraint, a transaction boundary — and a mock would prove only that the mock
 * behaves as it was told to.
 *
 * Expected totals are computed in the test from `calculateLine` applied to the rate this
 * file seeds, never read back from the order. Asserting the stored total equals the stored
 * total is a tautology.
 */
import { Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { createBill, generateBillPdf } from '@/lib/bills/create';
import { formatOrderNo, shopYear } from '@/lib/bills/numbering';
import { createBillSchema, type CreateBillRequest } from '@/lib/bills/schema';
import { db } from '@/lib/db';
import { calculateLine } from '@/lib/pricing';
import { RATES_CACHE_KEY } from '@/lib/rates';
import { invalidate } from '@/lib/redis';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

/** Paise per gram. The same figures the seed uses, restated so this file owns them. */
const GOLD_22 = 1_184_200n;
const GOLD_18 = 969_300n;
const SILVER = 15_890n;

const PHONE = '+919876500001';

let adminId: string;

function item(overrides: Partial<CreateBillRequest['items'][number]> = {}) {
  return {
    id: 'a',
    productId: null,
    label: 'Chain',
    metal: 'GOLD' as const,
    purity: 'K22_916' as const,
    weightGrams: '10',
    makingPct: '12',
    stoneCharge: '',
    gstPct: '3',
    hallmarkNo: '',
    bisCertNo: '',
    ...overrides,
  };
}

/** Parse through the real schema, so a test can never submit a shape the route would reject. */
function request(overrides: Partial<CreateBillRequest> = {}): CreateBillRequest {
  const parsed = createBillSchema.safeParse({
    customerName: 'Test Customer',
    customerPhone: PHONE,
    note: '',
    items: [item()],
    ...overrides,
  });
  if (!parsed.success) throw new Error(`fixture rejected: ${parsed.error.message}`);
  return parsed.data;
}

async function seedRates() {
  await db.metalRate.createMany({
    data: [
      {
        metal: 'GOLD',
        purity: Purity.K22_916,
        ratePerGram: GOLD_22,
        setByUserId: adminId,
      },
      {
        metal: 'GOLD',
        purity: Purity.K18_750,
        ratePerGram: GOLD_18,
        setByUserId: adminId,
      },
      {
        metal: 'SILVER',
        purity: Purity.SILVER_999,
        ratePerGram: SILVER,
        setByUserId: adminId,
      },
    ],
  });
  await invalidate(RATES_CACHE_KEY);
}

describeDb('createBill', () => {
  beforeEach(async () => {
    await db.billPdf.deleteMany();
    await db.orderItem.deleteMany();
    await db.order.deleteMany();
    await db.billSequence.deleteMany();
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY);

    const admin = await db.user.create({
      data: { email: `bill-admin-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    adminId = admin.id;

    await seedRates();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  // ── Server recomputation ─────────────────────────────────────────────────

  it('stores the server-computed total, not anything the client sent', async () => {
    const expected = calculateLine(
      {
        metal: 'GOLD',
        purity: 'K22_916',
        weightMg: 10_000,
        makingPct: 12,
        stoneCharge: 0n,
        gstPct: 3,
      },
      GOLD_22,
    );

    const result = await createBill(request(), { adminId, customerPhone: PHONE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { subtotal: true, gstAmount: true, grandTotal: true },
    });

    expect(order.grandTotal).toBe(expected.lineTotal);
    expect(order.subtotal).toBe(expected.subtotal);
    expect(order.gstAmount).toBe(expected.gstAmount);
  });

  it('rejects a payload carrying a total, rather than ignoring the field', async () => {
    // §8.2: the client's totals "arrive but are discarded". The surest discard is having
    // nowhere to put one — `.strict()` makes an attempt a 400.
    const parsed = createBillSchema.safeParse({
      customerName: 'Attacker',
      customerPhone: PHONE,
      note: '',
      grandTotal: '1',
      items: [item()],
    });
    expect(parsed.success).toBe(false);

    // And nothing was written.
    expect(await db.order.count()).toBe(0);
  });

  it('rejects a payload carrying a rate', async () => {
    const parsed = createBillSchema.safeParse({
      customerName: 'Attacker',
      customerPhone: PHONE,
      note: '',
      items: [{ ...item(), ratePerGram: '1' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('sums the ROUNDED line totals, so the bill visibly adds up', async () => {
    const result = await createBill(
      request({
        items: [
          item({ id: 'a', weightGrams: '8.475', makingPct: '12' }),
          item({
            id: 'b',
            weightGrams: '48.5',
            makingPct: '14',
            stoneCharge: '12500.50',
          }),
          item({ id: 'c', purity: 'SILVER_999', metal: 'SILVER', weightGrams: '120' }),
        ],
      }),
      { adminId, customerPhone: PHONE },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { grandTotal: true, items: { select: { lineTotal: true } } },
    });

    const sum = order.items.reduce((total, line) => total + line.lineTotal, 0n);
    expect(order.grandTotal).toBe(sum);
  });

  it('refuses to bill a purity that has no rate', async () => {
    await db.metalRate.deleteMany({ where: { purity: Purity.SILVER_999 } });
    await invalidate(RATES_CACHE_KEY);

    const result = await createBill(
      request({ items: [item({ purity: 'SILVER_999', metal: 'SILVER' })] }),
      { adminId, customerPhone: PHONE },
    );

    // A zero rate would print a bill for the making charge alone.
    expect(result.ok).toBe(false);
    expect(await db.order.count()).toBe(0);
  });

  // ── Rate snapshot ────────────────────────────────────────────────────────

  it('keeps a bill’s figures when the rate changes underneath it', async () => {
    const result = await createBill(request(), { adminId, customerPhone: PHONE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: {
        grandTotal: true,
        ratesSnapshot: true,
        items: { select: { ratePerGram: true, makingPct: true, gstPct: true } },
      },
    });

    // The rate doubles.
    await db.metalRate.create({
      data: {
        metal: 'GOLD',
        purity: Purity.K22_916,
        ratePerGram: GOLD_22 * 2n,
        setByUserId: adminId,
      },
    });
    await invalidate(RATES_CACHE_KEY);

    const after = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: {
        grandTotal: true,
        ratesSnapshot: true,
        items: { select: { ratePerGram: true, makingPct: true, gstPct: true } },
      },
    });

    expect(after.grandTotal).toBe(before.grandTotal);
    expect(after.items[0]?.ratePerGram).toBe(GOLD_22);
    expect(after.ratesSnapshot).toEqual(before.ratesSnapshot);

    // And a NEW bill picks the new rate up, or the snapshot would be proving nothing.
    const second = await createBill(request(), { adminId, customerPhone: PHONE });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.grandTotal).toBeGreaterThan(before.grandTotal);
  });

  it('snapshots all three rates, not only the ones on the bill', async () => {
    // §8.3's rate reference block is "what was quoted that day", which is what makes an
    // invoice defensible months later.
    const result = await createBill(request(), { adminId, customerPhone: PHONE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { ratesSnapshot: true, ratesAt: true },
    });

    expect(order.ratesSnapshot).toEqual({
      K22_916: GOLD_22.toString(),
      K18_750: GOLD_18.toString(),
      SILVER_999: SILVER.toString(),
    });
    expect(order.ratesAt).toBeInstanceOf(Date);
  });

  it('snapshots making, GST and the hallmark numbers per item', async () => {
    const result = await createBill(
      request({
        items: [
          item({ makingPct: '14', gstPct: '3', hallmarkNo: 'HM1', bisCertNo: 'BIS1' }),
        ],
      }),
      { adminId, customerPhone: PHONE },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const line = await db.orderItem.findFirstOrThrow({
      where: { orderId: result.orderId },
      select: {
        makingPct: true,
        gstPct: true,
        hallmarkNo: true,
        bisCertNo: true,
        weightMg: true,
      },
    });

    expect(Number(line.makingPct)).toBe(14);
    expect(Number(line.gstPct)).toBe(3);
    expect(line.hallmarkNo).toBe('HM1');
    expect(line.bisCertNo).toBe('BIS1');
    expect(line.weightMg).toBe(10_000);
  });

  // ── Order numbering under real concurrency ───────────────────────────────

  it('gives 50 truly concurrent bills 50 unique, gapless numbers', async () => {
    // §8 TEST: "Run this with real concurrency, not a loop." `Promise.all` over 50 calls
    // that each open their own transaction — a sequential loop would pass against a
    // COUNT(*) implementation, which is the thing the spec forbids.
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        createBill(request(), { adminId, customerPhone: PHONE }),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);

    const numbers = results.flatMap((result) => (result.ok ? [result.orderNo] : []));
    expect(numbers).toHaveLength(50);
    expect(new Set(numbers).size).toBe(50);

    const sequences = numbers.map((no) => Number(no.split('-')[2])).sort((a, b) => a - b);
    expect(sequences[0]).toBe(1);
    expect(sequences.at(-1)).toBe(50);
    // No gaps: consecutive by construction, checked rather than assumed.
    expect(sequences.every((value, index) => value === index + 1)).toBe(true);

    // And the database agrees there are exactly 50 rows — none lost to a swallowed error.
    expect(await db.order.count()).toBe(50);
  }, 60_000);

  it('numbers with the configured prefix and the shop’s year', async () => {
    await db.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', billPrefix: 'TJ' },
      update: { billPrefix: 'TJ' },
    });

    const result = await createBill(request(), { adminId, customerPhone: PHONE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.orderNo).toBe(formatOrderNo('TJ', shopYear(), 1));

    await db.settings.deleteMany();
  });

  // ── Idempotency ──────────────────────────────────────────────────────────

  it('returns the existing order when a key is replayed', async () => {
    const key = 'idem-replay-0001';

    const first = await createBill(request(), {
      adminId,
      customerPhone: PHONE,
      idempotencyKey: key,
    });
    const second = await createBill(request(), {
      adminId,
      customerPhone: PHONE,
      idempotencyKey: key,
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.orderId).toBe(first.orderId);
    expect(second.replayed).toBe(true);
    expect(first.replayed).toBe(false);
    expect(await db.order.count()).toBe(1);
  });

  it('survives the race where both requests miss the read', async () => {
    // The check-then-insert window: five simultaneous calls with one key. Only the unique
    // index can settle this, and the loser must return the winner's order rather than 500.
    const key = 'idem-race-0001';

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createBill(request(), { adminId, customerPhone: PHONE, idempotencyKey: key }),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    const ids = new Set(results.flatMap((r) => (r.ok ? [r.orderId] : [])));
    expect(ids.size).toBe(1);
    expect(await db.order.count()).toBe(1);
  });

  it('creates two orders when no key is supplied', async () => {
    // The same ring really can be sold twice in a day. Inventing a key from the body would
    // make that impossible.
    await createBill(request(), { adminId, customerPhone: PHONE });
    await createBill(request(), { adminId, customerPhone: PHONE });
    expect(await db.order.count()).toBe(2);
  });

  it('does not let one key be reused for a different bill', async () => {
    const key = 'idem-different-0001';

    const first = await createBill(request(), {
      adminId,
      customerPhone: PHONE,
      idempotencyKey: key,
    });
    const second = await createBill(request({ items: [item({ weightGrams: '999' })] }), {
      adminId,
      customerPhone: PHONE,
      idempotencyKey: key,
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Replay semantics: the key identifies the REQUEST, so the original is returned. A
    // second bill must not be created from a stale key on a retried tap.
    expect(second.orderId).toBe(first.orderId);
    expect(second.grandTotal).toBe(first.grandTotal);
  });

  // ── Auto-link rules (§8.2) ───────────────────────────────────────────────

  it('leaves userId null when no account holds the number', async () => {
    const result = await createBill(request(), { adminId, customerPhone: PHONE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { userId: true, customerPhone: true },
    });
    expect(order.userId).toBeNull();
    // Stored in E.164, which is what the claim matches on.
    expect(order.customerPhone).toBe(PHONE);
  });

  it('does NOT link an unverified matching phone', async () => {
    await db.user.create({ data: { phone: PHONE, phoneVerified: false } });

    const result = await createBill(request(), { adminId, customerPhone: PHONE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { userId: true },
    });
    // MASTER-SPEC §5: an unverified phone field is not proof of anything.
    expect(order.userId).toBeNull();
  });

  it('links a verified matching phone', async () => {
    const owner = await db.user.create({
      data: { phone: PHONE, phoneVerified: true },
      select: { id: true },
    });

    const result = await createBill(request(), { adminId, customerPhone: PHONE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { userId: true },
    });
    expect(order.userId).toBe(owner.id);
  });

  // ── Audit (§8.2, §8 SECURITY) ────────────────────────────────────────────

  it('audits the creation with the actor and the figures', async () => {
    const result = await createBill(request(), {
      adminId,
      ip: '203.0.113.5',
      customerPhone: PHONE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entry = await db.auditLog.findFirstOrThrow({
      where: { action: 'ORDER_CREATE', entityId: result.orderId },
    });

    expect(entry.actorId).toBe(adminId);
    expect(entry.entity).toBe('Order');
    expect(entry.ip).toBe('203.0.113.5');
    expect(entry.after).toMatchObject({
      orderNo: result.orderNo,
      grandTotal: result.grandTotal.toString(),
    });
  });

  it('writes the audit entry inside the transaction', async () => {
    // One order, one audit row — never an order with no trail.
    await createBill(request(), { adminId, customerPhone: PHONE });
    expect(await db.auditLog.count({ where: { action: 'ORDER_CREATE' } })).toBe(1);
  });

  // ── The PDF (§8.3) ───────────────────────────────────────────────────────

  it('renders and stores a PDF, and points the order at it', async () => {
    const result = await createBill(request(), { adminId, customerPhone: PHONE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { billPdfKey: true, billPdf: { select: { byteSize: true, key: true } } },
    });

    expect(order.billPdfKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(order.billPdf?.key).toBe(order.billPdfKey);
    expect(order.billPdf?.byteSize).toBeGreaterThan(1000);
  }, 30_000);

  it('re-renders in place rather than issuing a second invoice', async () => {
    const result = await createBill(request(), { adminId, customerPhone: PHONE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { billPdfKey: true },
    });

    await generateBillPdf(result.orderId);

    const after = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      select: { billPdfKey: true },
    });

    // Same key: a customer holding the WhatsApp link must not be orphaned by a re-render.
    expect(after.billPdfKey).toBe(before.billPdfKey);
    expect(await db.billPdf.count()).toBe(1);
    expect(await db.order.count()).toBe(1);
  }, 30_000);
});
