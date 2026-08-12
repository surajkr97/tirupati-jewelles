/**
 * Stage 5E — the split a bill screen and a bill PDF both read.
 *
 * `splitStoredLine` recovers metal value, making charge and stone charge from a line's own
 * snapshot, because `OrderItem` stores only `lineTotal`. Phase 8 kept it private inside
 * `buildBillData`; Stage 5E exported it so `/admin/bills/[id]` shows the same breakdown as
 * the invoice rather than carrying a second copy of the arithmetic.
 *
 * Two properties matter, and neither had a test of its own:
 *
 *   1. Fed the stored inputs it reproduces the stored total. That is what makes it safe to
 *      print the parts beside the whole — the same argument `lib/calculator/summary.test.ts`
 *      makes about the calculator's breakdown.
 *   2. When it does NOT reproduce it, it throws rather than returning a plausible split.
 *      The stored figure is what the customer paid; a screen that quietly showed components
 *      derived from different inputs would be inventing an explanation for real money.
 *
 * The second is the one the admin page's fallback branch depends on, so it is asserted here
 * rather than assumed from a comment.
 */
import { Metal, Purity } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { splitStoredLine } from '@/lib/bills/render';
import { calculateLine } from '@/lib/pricing';

type StoredItem = Parameters<typeof splitStoredLine>[0];

/** Gold 22K at ₹11,842/g, the figure the rest of the bill suite prices with. */
const RATE = 1_184_200n;

function storedLine(over: Partial<StoredItem> = {}): StoredItem {
  /**
   * The overrides are applied BEFORE the total is computed, not after.
   *
   * Spreading `over` on top of a total derived from the base values produced a fixture that
   * was internally inconsistent by construction — every case that changed a weight or a rate
   * threw the mismatch error, which made the guard look broken when it was working perfectly.
   * The stored total has to be what the engine produces from the stored inputs, because that
   * is exactly how `createBill` writes it.
   */
  const item = {
    name: 'Temple necklace',
    metal: Metal.GOLD,
    purity: Purity.K22_916,
    weightMg: 48_500,
    ratePerGram: RATE,
    makingPct: '12',
    stoneCharge: 0n,
    gstPct: '3',
    hallmarkNo: null,
    bisCertNo: null,
    lineTotal: 0n,
    ...over,
  };

  return { ...item, lineTotal: recompute(item) };
}

describe('splitStoredLine', () => {
  it.each([
    ['a plain line', {}],
    ['a fractional weight', { weightMg: 8_437 }],
    ['no making charge', { makingPct: '0' }],
    ['a stone charge', { stoneCharge: 250_000n }],
    ['silver', { metal: Metal.SILVER, purity: Purity.SILVER_999, ratePerGram: 9_500n }],
    ['a zero weight', { weightMg: 0 }],
  ])('%s: the parts add up to the stored total', (_name, over) => {
    const item = storedLine(over as Partial<StoredItem>);
    const line = splitStoredLine(item, 'JW-2026-0001');

    // metal + making + stone === taxable, and taxable + GST === the stored line total.
    expect(line.metalValue + line.makingCharge + line.stoneCharge).toBe(line.subtotal);
    expect(line.subtotal + line.gstAmount).toBe(item.lineTotal);
    expect(line.lineTotal).toBe(item.lineTotal);
  });

  it('every figure stays integer paise', () => {
    const line = splitStoredLine(storedLine({ weightMg: 3_333 }), 'JW-2026-0002');
    for (const [key, value] of Object.entries(line)) {
      expect(typeof value, `${key} must be a bigint`).toBe('bigint');
    }
  });

  it('prices at the SNAPSHOTTED rate, not at any current one', () => {
    // The whole point of §8.2's snapshot: a bill reprinted later shows the old number.
    const line = splitStoredLine(storedLine({ ratePerGram: 500_000n }), 'JW-2026-0003');
    expect(line.metalValue).toBe((500_000n * 48_500n) / 1000n);
  });

  it('throws when the stored total disagrees with its own inputs', () => {
    // A line whose total was tampered with, or written by a different calculation.
    const item = storedLine();
    const corrupt = { ...item, lineTotal: item.lineTotal + 1n };

    expect(() => splitStoredLine(corrupt, 'JW-2026-0004')).toThrow(
      /JW-2026-0004.*does not match/s,
    );
  });

  it('names the bill in the failure, because that is what gets investigated', () => {
    const item = storedLine();
    expect(() =>
      splitStoredLine({ ...item, lineTotal: 1n }, 'JW-2026-0999'),
    ).toThrow(/JW-2026-0999/);
  });
});

function recompute(item: Omit<StoredItem, 'lineTotal'> & { lineTotal?: bigint }): bigint {
  return calculateLine(
    {
      metal: item.metal,
      purity: item.purity as 'K22_916',
      weightMg: item.weightMg,
      makingPct: Number(item.makingPct),
      stoneCharge: item.stoneCharge,
      gstPct: Number(item.gstPct),
    },
    item.ratePerGram,
  ).lineTotal;
}
