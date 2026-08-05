/**
 * Phase 4 TEST — unit conversion and the sanity guard.
 *
 *   "Unit: perGramToPer10g / perGramToPerKg round-trip without drift."
 *   "Unit: sanity guard rejects a 10× rate without `confirmed`."
 *
 * Conversion is imported from the module that owns it (§4.1: "Conversion helpers, and
 * only here"). The `setRate` guard is exercised through real Postgres, since it depends
 * on reading the previous row.
 */
import { Metal, Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `revalidateTag` reads Next's request-scoped static-generation store, which does not
 * exist outside a render or a route handler, so it throws an invariant in a bare Node
 * test process.
 *
 * Mocked here rather than wrapped in a try/catch inside `setRate`: swallowing the error
 * in production would let a revalidation failure pass unnoticed, and the symptom of that
 * is a stale price on a customer's screen. The call itself is covered by the E2E path
 * (admin sets a rate → the homepage reflects it).
 */
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { db } from '@/lib/db';
import { formatINR, formatPercent } from '@/lib/money';
import {
  fromDisplayUnit,
  perGramToPer10g,
  perGramToPerKg,
  per10gToPerGram,
  perKgToPerGram,
  SANITY_THRESHOLD,
  setRate,
  toDisplayUnit,
} from '@/lib/rates';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

describe('unit conversion', () => {
  it('gold: per-gram → per-10g is ×10', () => {
    expect(perGramToPer10g(1_184_200n)).toBe(11_842_000n);
  });

  it('silver: per-gram → per-kg is ×1000', () => {
    expect(perGramToPerKg(15_890n)).toBe(15_890_000n);
  });

  it.each([1_184_200n, 969_300n, 1n, 999_999_999n])(
    'gold round-trips %s without drift',
    (perGram) => {
      expect(per10gToPerGram(perGramToPer10g(perGram))).toBe(perGram);
    },
  );

  it.each([15_890n, 1n, 987_654_321n])(
    'silver round-trips %s without drift',
    (perGram) => {
      expect(perKgToPerGram(perGramToPerKg(perGram))).toBe(perGram);
    },
  );

  it('round-trips through the metal-aware helpers', () => {
    for (const [metal, perGram] of [
      [Metal.GOLD, 1_184_200n],
      [Metal.SILVER, 15_890n],
    ] as const) {
      expect(fromDisplayUnit(metal, toDisplayUnit(metal, perGram))).toBe(perGram);
    }
  });

  it('is exact — bigint, never float', () => {
    // 0.1 + 0.2 !== 0.3 is why MASTER-SPEC §4 forbids float money. A thousand
    // conversions must not accumulate a single paisa of error.
    let value = 1_184_237n;
    for (let i = 0; i < 1_000; i += 1) {
      value = per10gToPerGram(perGramToPer10g(value));
    }
    expect(value).toBe(1_184_237n);
  });
});

describe('formatINR — Indian grouping', () => {
  it.each([
    [0n, '₹0'],
    [100n, '₹1'],
    [11_842_000n, '₹1,18,420'],
    // ₹1 crore = 1,00,00,000 rupees = 1_000_000_000 paise.
    [1_000_000_000n, '₹1,00,00,000'],
    [10_000_000_000n, '₹10,00,00,000'],
  ])('%s paise → %s', (paise, expected) => {
    // Lakh/crore grouping, not thousands — ₹1,18,420 rather than ₹118,420.
    expect(formatINR(paise)).toBe(expected);
  });

  it('shows paise only when asked', () => {
    expect(formatINR(11_842_050n, true)).toBe('₹1,18,420.50');
    expect(formatINR(11_842_050n)).toBe('₹1,18,420');
  });

  it('handles negative deltas', () => {
    expect(formatINR(-14_200n)).toBe('-₹142');
  });

  it('formatPercent guards against a zero base', () => {
    expect(formatPercent(100n, 0n)).toBe('0.00%');
  });
});

describeDb('setRate — the fat-finger guard', () => {
  let adminId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();

    const admin = await db.user.create({
      data: { email: `rates-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await db.$disconnect();
  });

  const base = {
    metal: Metal.GOLD,
    purity: Purity.K22_916,
  };

  it('accepts the first rate — nothing to compare against', async () => {
    const result = await setRate({ ...base, ratePerGram: 1_184_200n, userId: adminId });
    expect(result.ok).toBe(true);
  });

  it('accepts a small change', async () => {
    await setRate({ ...base, ratePerGram: 1_184_200n, userId: adminId });
    // +2%, well inside the threshold.
    const result = await setRate({ ...base, ratePerGram: 1_207_884n, userId: adminId });
    expect(result.ok).toBe(true);
  });

  it('REJECTS a 10× rate without confirmation — the extra-zero typo', async () => {
    await setRate({ ...base, ratePerGram: 1_184_200n, userId: adminId });

    const result = await setRate({ ...base, ratePerGram: 11_842_000n, userId: adminId });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('needs_confirmation');
      expect(result.changePct).toBeGreaterThan(SANITY_THRESHOLD);
    }

    // And nothing was written — a rejected rate must not reach the table, or it would
    // flow into every product page and every bill until someone noticed.
    expect(await db.metalRate.count()).toBe(1);
  });

  it('accepts the same 10× change when confirmed', async () => {
    await setRate({ ...base, ratePerGram: 1_184_200n, userId: adminId });

    const result = await setRate({
      ...base,
      ratePerGram: 11_842_000n,
      userId: adminId,
      confirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(await db.metalRate.count()).toBe(2);
  });

  it('rejects a large DROP too, not just a rise', async () => {
    await setRate({ ...base, ratePerGram: 1_184_200n, userId: adminId });
    const result = await setRate({ ...base, ratePerGram: 118_420n, userId: adminId });
    expect(result.ok).toBe(false);
  });

  it('inserts a new row rather than updating — history is an audit trail', async () => {
    await setRate({ ...base, ratePerGram: 1_184_200n, userId: adminId });
    await setRate({ ...base, ratePerGram: 1_190_000n, userId: adminId });

    // Phase 8 bills snapshot from this table; rewriting a row would change what a past
    // bill says it charged.
    expect(await db.metalRate.count()).toBe(2);
  });

  it('writes an AuditLog entry with actor, before and after', async () => {
    await setRate({ ...base, ratePerGram: 1_184_200n, userId: adminId });
    await setRate({
      ...base,
      ratePerGram: 1_190_000n,
      userId: adminId,
      ip: '203.0.113.7',
    });

    const log = await db.auditLog.findFirst({
      where: { action: 'RATE_SET' },
      orderBy: { createdAt: 'desc' },
    });

    expect(log?.actorId).toBe(adminId);
    expect(log?.ip).toBe('203.0.113.7');
    expect(log?.after).toEqual({ ratePerGram: '1190000' });
  });

  it('treats each metal and purity independently', async () => {
    await setRate({ ...base, ratePerGram: 1_184_200n, userId: adminId });

    // Silver's first rate is unrelated to gold's, so the guard must not compare them.
    const result = await setRate({
      metal: Metal.SILVER,
      purity: Purity.SILVER_999,
      ratePerGram: 15_890n,
      userId: adminId,
    });

    expect(result.ok).toBe(true);
  });
});
