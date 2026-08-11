/**
 * Stage 4D — the breakdown's parts must add up to the engine's whole.
 *
 * `summariseTotal` exists so the calculator can show metal value, making charges and stone
 * charges as separate lines (brief §16). Those come from summing `LineResult` fields the
 * engine already produced — but a displayed sum that does not reconcile with the total
 * beneath it is worse than no breakdown at all, because it invites a customer to check the
 * arithmetic and find it wrong.
 *
 * So the invariant is asserted rather than assumed: **metal + making + stone === subtotal**,
 * and **subtotal + GST === grandTotal**, over inputs that exercise the awkward cases the
 * pricing suite already cares about — fractional weights, 0% and 100% making, a zero line,
 * and a stone charge with no making charge.
 *
 * If a future engine change adds a component to `subtotal` that this does not sum, this
 * fails. That is the entire point.
 */
import { describe, expect, it } from 'vitest';

import { summariseTotal } from '@/lib/calculator/summary';
import { calculateTotal, type LineInput, type RatesByPurity } from '@/lib/pricing';

/** Paise per gram. Gold 22K at ₹11,842/g, 18K at ₹9,693/g, silver at ₹95/g. */
const RATES: RatesByPurity = {
  K22_916: 1_184_200n,
  K18_750: 969_300n,
  SILVER_999: 9_500n,
};

const GST = 3;

function line(over: Partial<LineInput> = {}): LineInput {
  return {
    metal: 'GOLD',
    purity: 'K22_916',
    weightMg: 10_000,
    makingPct: 12,
    stoneCharge: 0n,
    gstPct: GST,
    ...over,
  };
}

describe('summariseTotal reconciles with the engine', () => {
  it.each([
    ['one plain line', [line()]],
    ['a fractional weight', [line({ weightMg: 8_437 })]],
    ['zero making charge', [line({ makingPct: 0 })]],
    ['100% making charge', [line({ makingPct: 100 })]],
    ['a stone charge', [line({ stoneCharge: 250_000n })]],
    ['stone charge with no making', [line({ makingPct: 0, stoneCharge: 99_999n })]],
    ['a zero-weight line', [line({ weightMg: 0 })]],
    ['mixed purities', [line(), line({ metal: 'GOLD', purity: 'K18_750' }), line({ metal: 'SILVER', purity: 'SILVER_999', weightMg: 1_000_000 })]],
    [
      'twenty lines',
      Array.from({ length: 20 }, (_, i) => line({ weightMg: 1_000 + i * 137, makingPct: i })),
    ],
  ])('%s', (_name, inputs) => {
    const total = calculateTotal(inputs as LineInput[], RATES);
    const summary = summariseTotal(total);

    // The parts of the subtotal.
    expect(summary.metalValue + summary.makingCharge + summary.stoneCharge).toBe(
      total.subtotal,
    );
    // And the whole.
    expect(summary.subtotal + summary.gst).toBe(total.grandTotal);

    // The aggregates are the engine's own values, passed through untouched.
    expect(summary.subtotal).toBe(total.subtotal);
    expect(summary.gst).toBe(total.totalGst);
    expect(summary.grandTotal).toBe(total.grandTotal);
  });

  it('reports a stone charge only when one exists', () => {
    expect(summariseTotal(calculateTotal([line()], RATES)).hasStoneCharge).toBe(false);
    expect(
      summariseTotal(calculateTotal([line({ stoneCharge: 1n })], RATES)).hasStoneCharge,
    ).toBe(true);
  });

  it('is all zeroes for an empty total rather than throwing', () => {
    const summary = summariseTotal(calculateTotal([], RATES));
    expect(summary.metalValue).toBe(0n);
    expect(summary.grandTotal).toBe(0n);
    expect(summary.hasStoneCharge).toBe(false);
  });

  it('every figure is a bigint — never a number, never a float', () => {
    const summary = summariseTotal(calculateTotal([line({ weightMg: 3_333 })], RATES));
    for (const [key, value] of Object.entries(summary)) {
      if (key === 'hasStoneCharge') continue;
      expect(typeof value, `${key} must stay integer paise`).toBe('bigint');
    }
  });
});
