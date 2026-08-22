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
  GOLD_PURITIES,
  goldRateFromPure,
  isValidCombination,
  perGramToPer10g,
  perGramToPerKg,
  per10gToPerGram,
  perKgToPerGram,
  pureFromGoldRate,
  quotedPureRate,
  SANITY_THRESHOLD,
  setGoldRates,
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

describe('metal / purity pairing', () => {
  it.each([
    [Metal.GOLD, Purity.K22_916],
    [Metal.GOLD, Purity.K18_750],
    [Metal.SILVER, Purity.SILVER_999],
  ])('%s + %s is valid', (metal, purity) => {
    expect(isValidCombination(metal, purity)).toBe(true);
  });

  it.each([
    [Metal.GOLD, Purity.SILVER_999],
    [Metal.SILVER, Purity.K22_916],
    [Metal.SILVER, Purity.K18_750],
  ])('%s + %s is rejected', (metal, purity) => {
    // A well-formed request for a rate that cannot exist. Both the admin POST and the
    // public history GET reject it rather than returning an empty result, which would
    // read as "no data yet" and hide the mistake.
    expect(isValidCombination(metal, purity)).toBe(false);
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

/**
 * The "one gold field" change — `lib/gold-purity.ts` and `setGoldRates`.
 *
 * The property that matters is not "916 is 91.6% of 24K", which is arithmetic. It is that
 * the two stored rows can no longer disagree about what gold costs, which is a property of
 * how they are WRITTEN — hence the transaction and all-or-nothing guard tests below.
 */
describe('gold purity derivation', () => {
  it('applies the fineness — 22K is 91.6% of pure, 18K is 75%', () => {
    // ₹1,29,000 per 10g of 24K → per gram.
    const pure = 1_290_000n;

    expect(goldRateFromPure(pure, 'K22_916')).toBe(1_181_640n);
    expect(goldRateFromPure(pure, 'K18_750')).toBe(967_500n);
  });

  /**
   * The inverse is lossy and the test says so rather than picking figures that hide it.
   *
   * Rates are integer paise per gram, so applying a fineness throws away up to half a paise
   * with nothing left to recover it from. One paise per gram is the real bound; asserting
   * exact equality here would only mean the fixtures were chosen to divide cleanly.
   */
  it('reads back within a paise per gram of the pure rate that made it', () => {
    // Deliberately awkward figures — the ones divisible by 1000 would pass a truncating
    // implementation too, and truncation is what biases every rate down by a paise.
    for (const pure of [1_290_000n, 1_184_207n, 999_999n, 1n, 12_345_678n]) {
      for (const purity of GOLD_PURITIES) {
        const back = pureFromGoldRate(goldRateFromPure(pure, purity), purity);
        const drift = back > pure ? back - pure : pure - back;
        expect(drift).toBeLessThanOrEqual(1n);
      }
    }
  });

  /**
   * What the admin actually experiences, which is the property worth guarding.
   *
   * They type whole rupees per 10 grams, the app derives and stores 916, and tomorrow the
   * field is pre-filled from that stored row. If this drifts, the page shows a rate they
   * did not type — `quotedPureRate` exists for exactly this and the snap is what makes it
   * hold.
   */
  it('shows an admin back the whole-rupee figure they typed', () => {
    for (const rupeesPer10g of [129_000n, 118_420n, 99_999n, 5_000n, 250_001n]) {
      const typedDisplay = rupeesPer10g * 100n;
      // The write path: display paise → per gram → apply fineness. Then read it back.
      const stored22 = goldRateFromPure(per10gToPerGram(typedDisplay), 'K22_916');

      expect(quotedPureRate(perGramToPer10g(stored22), 'K22_916')).toBe(typedDisplay);
    }
  });

  it('rounds half-up rather than truncating — no systematic discount', () => {
    // 1n × 750 / 1000 = 0.75. Truncation stores 0, which is a free gram of gold.
    expect(goldRateFromPure(1n, 'K18_750')).toBe(1n);
    // 3n × 916 / 1000 = 2.748 — nearest is 3, not 2.
    expect(goldRateFromPure(3n, 'K22_916')).toBe(3n);
  });

  it('is exact — bigint, never float', () => {
    // 0.916 is not representable in binary floating point. `12_345_678 * 0.916` is
    // 11_308_641.048 in JS and rounds to ...641; the integer path is what makes it exact.
    expect(goldRateFromPure(12_345_678n, 'K22_916')).toBe(11_308_641n);
  });
});

describeDb('setGoldRates — one typed rate, both rows', () => {
  let adminId: string;

  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();

    const admin = await db.user.create({
      data: { email: `gold-${Date.now()}@example.com`, role: Role.ADMIN },
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

  /** The 916 and 750 rates in force, newest row per purity. */
  async function liveGold(): Promise<Record<string, bigint | undefined>> {
    const rows = await db.metalRate.findMany({
      where: { metal: Metal.GOLD },
      orderBy: { effectiveAt: 'desc' },
    });

    return Object.fromEntries(
      GOLD_PURITIES.map((purity) => [
        purity,
        rows.find((row) => row.purity === purity)?.ratePerGram,
      ]),
    );
  }

  it('writes a row for BOTH purities from one figure', async () => {
    const result = await setGoldRates({ purePerGram: 1_290_000n, userId: adminId });

    expect(result.ok).toBe(true);
    expect(await liveGold()).toEqual({ K22_916: 1_181_640n, K18_750: 967_500n });
  });

  it('leaves the two rows describing the same metal', async () => {
    await setGoldRates({ purePerGram: 1_290_000n, userId: adminId });
    const live = await liveGold();

    // The whole point of the single field: read either row back as a pure rate and you get
    // the same number. Two hand-typed fields could not promise this.
    expect(pureFromGoldRate(live.K22_916 as bigint, 'K22_916')).toBe(
      pureFromGoldRate(live.K18_750 as bigint, 'K18_750'),
    );
  });

  it('audits per purity, not per keystroke — a bill is priced from 916 or 750', async () => {
    await setGoldRates({ purePerGram: 1_290_000n, userId: adminId, ip: '203.0.113.7' });

    const logs = await db.auditLog.findMany({ where: { action: 'RATE_SET' } });

    expect(logs).toHaveLength(2);
    expect(logs.map((log) => log.entityId).sort()).toEqual([
      'GOLD:K18_750',
      'GOLD:K22_916',
    ]);
    expect(logs.every((log) => log.actorId === adminId && log.ip === '203.0.113.7')).toBe(
      true,
    );
  });

  it('REJECTS a 10× rate without confirmation, and writes NEITHER row', async () => {
    await setGoldRates({ purePerGram: 1_290_000n, userId: adminId });

    const result = await setGoldRates({ purePerGram: 12_900_000n, userId: adminId });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.changePct).toBeGreaterThan(SANITY_THRESHOLD);
      // Named in the unit the admin typed in, so the dialog can quote it back to them.
      expect(result.previousPure).toBe(1_290_000n);
    }

    // All-or-nothing. A half-applied gold change is the exact inconsistency this whole
    // change exists to remove — 22K priced off today, 18K off yesterday.
    expect(await db.metalRate.count()).toBe(2);
  });

  it('accepts the same 10× change when confirmed', async () => {
    await setGoldRates({ purePerGram: 1_290_000n, userId: adminId });

    const result = await setGoldRates({
      purePerGram: 12_900_000n,
      userId: adminId,
      confirmed: true,
    });

    expect(result.ok).toBe(true);
    expect(await db.metalRate.count()).toBe(4);
  });

  it('holds back both rows when only ONE purity trips the guard', async () => {
    // A shop that set 916 and 750 by hand can hold a pair that no single 24K rate implies.
    // Here 750 is left far below where the new pure rate puts it, so the 18K row breaches
    // the threshold while the 22K row does not.
    await db.metalRate.createMany({
      data: [
        {
          metal: Metal.GOLD,
          purity: Purity.K22_916,
          ratePerGram: 1_181_640n,
          setByUserId: adminId,
        },
        {
          metal: Metal.GOLD,
          purity: Purity.K18_750,
          ratePerGram: 500_000n,
          setByUserId: adminId,
        },
      ],
    });

    const result = await setGoldRates({ purePerGram: 1_290_000n, userId: adminId });

    expect(result.ok).toBe(false);
    // Reported against the row that actually breached, so the figure in the dialog is one
    // the admin can recognise as wrong.
    if (!result.ok) expect(result.previousPure).toBe(666_667n);
    expect(await db.metalRate.count()).toBe(2);
  });

  it('accepts the first gold rate — nothing to compare against', async () => {
    const result = await setGoldRates({ purePerGram: 1_290_000n, userId: adminId });
    expect(result.ok).toBe(true);
  });

  it('does not disturb silver', async () => {
    await setRate({
      metal: Metal.SILVER,
      purity: Purity.SILVER_999,
      ratePerGram: 15_890n,
      userId: adminId,
    });

    await setGoldRates({ purePerGram: 1_290_000n, userId: adminId });

    expect(await db.metalRate.count({ where: { metal: Metal.SILVER } })).toBe(1);
  });
});
