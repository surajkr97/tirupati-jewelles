/**
 * Phase 5 TEST — the pricing engine.
 * specs/05-calculator.md: "the most test-critical phase. Money bugs here become customer
 * disputes."
 *
 * ── On the golden file ──
 * `pricing.golden.json` was computed by a separate implementation written from
 * MASTER-SPEC §4 in Python, using exact `Fraction` arithmetic — the "verified
 * independently with a spreadsheet" cross-check §5 TEST asks for. It carries both the
 * expected integer paise and the exact rational value, so a disagreement can be judged
 * rather than guessed at.
 *
 * §5 TEST: "If code and fixture disagree, the fixture is right until proven otherwise."
 */
import { describe, expect, it } from 'vitest';

import golden from '@/lib/pricing.golden.json';
import {
  calculateLine,
  calculateTotal,
  divideRoundHalfEven,
  gramsToMilligrams,
  MAX_WEIGHT_MG,
  PricingError,
  PURITIES,
  rupeesToPaise,
  type LineInput,
  type PurityKey,
  type RatesByPurity,
} from '@/lib/pricing';

/** The seeded rates, in paise per gram (MASTER-SPEC §4). */
const RATES: RatesByPurity = {
  K22_916: 1_184_200n,
  K18_750: 969_300n,
  SILVER_999: 15_890n,
};

const line = (over: Partial<LineInput> = {}): LineInput => ({
  metal: 'GOLD',
  purity: 'K22_916',
  weightMg: 10_000,
  makingPct: 12,
  stoneCharge: 0n,
  gstPct: 3,
  ...over,
});

// ──────────────────────────────────────────────────── golden files

describe('golden files — 20 independently computed cases', () => {
  it('has at least the 20 cases §5 TEST asks for', () => {
    // 22, not 20. The last two were added after a mutation test showed that rounding the
    // intermediate subtotal — the single thing §5.1 warns about hardest — passed all
    // twenty original cases. See "never rounds an intermediate" below.
    expect(golden.length).toBeGreaterThanOrEqual(20);
  });

  it.each(golden.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const result = calculateLine(
      {
        metal: testCase.input.metal as 'GOLD' | 'SILVER',
        purity: testCase.input.purity as PurityKey,
        weightMg: testCase.input.weightMg,
        makingPct: testCase.input.makingPct,
        stoneCharge: BigInt(testCase.input.stoneCharge),
        gstPct: testCase.input.gstPct,
      },
      BigInt(testCase.ratePerGram),
    );

    expect(result).toEqual({
      metalValue: BigInt(testCase.expected.metalValue),
      makingCharge: BigInt(testCase.expected.makingCharge),
      stoneCharge: BigInt(testCase.expected.stoneCharge),
      subtotal: BigInt(testCase.expected.subtotal),
      gstAmount: BigInt(testCase.expected.gstAmount),
      lineTotal: BigInt(testCase.expected.lineTotal),
    });
  });

  it('every golden lineTotal is the exact value rounded, never a re-derivation', () => {
    for (const testCase of golden) {
      // The fixture carries the exact rational as `numerator/denominator`. Recomputing the
      // rounding here means a wrong `expected` cannot hide behind a matching implementation.
      const [numerator = '0', denominator = '1'] = testCase.exact.lineTotal.split('/');
      const rounded = divideRoundHalfEven(BigInt(numerator), BigInt(denominator));

      expect(rounded).toBe(BigInt(testCase.expected.lineTotal));
    }
  });

  it('the visible breakdown adds up on every golden case', () => {
    for (const testCase of golden) {
      const e = testCase.expected;

      // §5.4 puts metal → making → stones → GST → total on screen. A customer who adds
      // those four numbers must get the fifth.
      expect(
        BigInt(e.metalValue) +
          BigInt(e.makingCharge) +
          BigInt(e.stoneCharge) +
          BigInt(e.gstAmount),
      ).toBe(BigInt(e.lineTotal));
    }
  });
});

// ──────────────────────────────────────────────────── rounding

describe("banker's rounding — MASTER-SPEC §4", () => {
  it.each([
    [1n, 2n, 0n], // 0.5 → 0, even
    [3n, 2n, 2n], // 1.5 → 2, even
    [5n, 2n, 2n], // 2.5 → 2, even
    [7n, 2n, 4n], // 3.5 → 4, even
    [1n, 4n, 0n], // 0.25 → 0
    [3n, 4n, 1n], // 0.75 → 1
  ])('%s/%s → %s', (numerator, denominator, expected) => {
    expect(divideRoundHalfEven(numerator, denominator)).toBe(expected);
  });

  it('is unbiased over the halves, unlike half-up', () => {
    // Half-up on 0.5, 1.5, 2.5, 3.5 sums to 1+2+3+4 = 10; half-even gives 0+2+2+4 = 8,
    // which is what the exact sum (8) actually is. That difference, one half-paise per
    // rounded line always in the shop's favour, is the pattern an auditor looks for.
    const halves = [1n, 3n, 5n, 7n];
    const sum = halves.reduce((acc, n) => acc + divideRoundHalfEven(n, 2n), 0n);

    expect(sum).toBe(8n);
  });

  it('rounds negatives symmetrically — Phase 8 credit notes will need it', () => {
    expect(divideRoundHalfEven(-1n, 2n)).toBe(0n);
    expect(divideRoundHalfEven(-3n, 2n)).toBe(-2n);
    expect(divideRoundHalfEven(-5n, 2n)).toBe(-2n);
  });

  it('throws rather than returning Infinity on a zero denominator', () => {
    expect(() => divideRoundHalfEven(1n, 0n)).toThrow(PricingError);
  });

  it('rounds a real half-paise line total down when the floor is even', () => {
    // 0.02 g of 22K at 12.5% making, no GST: exactly 26,644.5 paise.
    const result = calculateLine(
      line({ weightMg: 20, makingPct: 12.5, gstPct: 0 }),
      RATES.K22_916,
    );

    expect(result.lineTotal).toBe(26_644n);
  });

  it('rounds a real half-paise line total up when the floor is odd', () => {
    // 0.025 g of 22K at 10% making, no GST: exactly 32,565.5 paise.
    const result = calculateLine(
      line({ weightMg: 25, makingPct: 10, gstPct: 0 }),
      RATES.K22_916,
    );

    expect(result.lineTotal).toBe(32_566n);
  });

  /**
   * §5.1: "Never round intermediates — that is the source of ₹1 mismatches between the
   * on-screen total and the printed bill."
   *
   * These exist because a mutation test earned them. Replacing the exact subtotal with a
   * rounded one before applying GST passed all twenty original golden cases and every
   * other assertion in this file — the warning the spec shouts loudest was the one thing
   * nothing checked. Both cases below change by exactly one paise under that mutation.
   */
  describe('never rounds an intermediate', () => {
    it('a fractional subtotal keeps its half-paise into the GST calculation', () => {
      // metal 23,684 + making 2,960.5 = subtotal 26,644.5 exactly, then ×1.03.
      // Exact:                26,644.5   × 1.03 = 27,443.835 → 27,444
      // Rounding subtotal first: 26,644  × 1.03 = 27,443.32  → 27,443  ✗
      const result = calculateLine(
        line({ weightMg: 20, makingPct: 12.5 }),
        RATES.K22_916,
      );

      expect(result.lineTotal).toBe(27_444n);
    });

    it('and the same trap where the subtotal would have rounded up', () => {
      // subtotal 32,565.5 exactly, then ×1.03.
      const result = calculateLine(line({ weightMg: 25, makingPct: 10 }), RATES.K22_916);

      expect(result.lineTotal).toBe(33_542n);
    });

    it('the fractional part is genuinely there, not an artefact of the test', () => {
      // Without GST the same input lands exactly on the half-paise boundary, which is the
      // proof that the two cases above are exercising a real fraction.
      const noGst = calculateLine(
        line({ weightMg: 20, makingPct: 12.5, gstPct: 0 }),
        RATES.K22_916,
      );

      expect(noGst.lineTotal).toBe(26_644n); // 26,644.5 → half-even → even neighbour
    });
  });
});

// ──────────────────────────────────────────────────── edge cases §5 TEST names

describe('edge cases', () => {
  it('zero weight gives zero, not NaN and not a crash', () => {
    const result = calculateLine(line({ weightMg: 0 }), RATES.K22_916);

    expect(result.lineTotal).toBe(0n);
    expect(result.metalValue).toBe(0n);
    expect(result.gstAmount).toBe(0n);
  });

  it('0.001 g — one milligram — still prices', () => {
    const result = calculateLine(line({ weightMg: 1 }), RATES.K22_916);

    expect(result.lineTotal).toBeGreaterThan(0n);
  });

  it('99999 g prices without overflow', () => {
    const result = calculateLine(line({ weightMg: 99_999_000 }), RATES.K22_916);

    // bigint has no 2^53 ceiling; this would silently lose precision as a Number.
    expect(result.lineTotal).toBe(136_607_945_907n);
    expect(typeof result.lineTotal).toBe('bigint');
  });

  it('making 0% charges metal and GST only', () => {
    const result = calculateLine(line({ makingPct: 0 }), RATES.K22_916);

    expect(result.makingCharge).toBe(0n);
    expect(result.subtotal).toBe(result.metalValue);
  });

  it('making 100% doubles the metal value before GST', () => {
    const result = calculateLine(line({ makingPct: 100 }), RATES.K22_916);

    expect(result.makingCharge).toBe(result.metalValue);
    expect(result.subtotal).toBe(result.metalValue * 2n);
  });

  it('GST 0% leaves the subtotal as the total', () => {
    const result = calculateLine(line({ gstPct: 0 }), RATES.K22_916);

    expect(result.gstAmount).toBe(0n);
    expect(result.lineTotal).toBe(result.subtotal);
  });

  it('a stone charge with no metal is priced and taxed', () => {
    const result = calculateLine(
      line({ weightMg: 0, stoneCharge: 1_500_000n }),
      RATES.K22_916,
    );

    expect(result.subtotal).toBe(1_500_000n);
    expect(result.lineTotal).toBe(1_545_000n); // +3%
  });

  it('a total over ₹1 crore is exact', () => {
    // MASTER-SPEC's bill edge cases include "total exceeding ₹1 crore". 1 crore rupees is
    // 10^9 paise, well past the point where float money starts lying.
    // 1 kg of 22K at 12% + 3% GST = ₹1,36,60,931.20 exactly.
    const result = calculateLine(line({ weightMg: 1_000_000 }), RATES.K22_916);

    expect(result.lineTotal).toBeGreaterThan(1_000_000_000n);
    expect(result.lineTotal).toBe(1_366_093_120n);

    // Exactly 100× the 10 g line — no drift accumulates with scale.
    const tenGrams = calculateLine(line(), RATES.K22_916);
    expect(result.lineTotal).toBe(tenGrams.lineTotal * 100n + 20n);
  });
});

// ──────────────────────────────────────────────────── rejection, not clamping

describe('invalid input throws — §5.1 forbids silent clamping', () => {
  it.each([
    ['a negative weight', { weightMg: -1 }],
    ['a fractional milligram', { weightMg: 10.5 }],
    ['NaN weight', { weightMg: Number.NaN }],
    ['Infinity weight', { weightMg: Number.POSITIVE_INFINITY }],
    ['a weight past the ceiling', { weightMg: MAX_WEIGHT_MG + 1 }],
    ['a negative making percentage', { makingPct: -5 }],
    ['making over 100%', { makingPct: 101 }],
    ['NaN making', { makingPct: Number.NaN }],
    ['a negative GST rate', { gstPct: -3 }],
    ['GST over 100%', { gstPct: 101 }],
    ['a negative stone charge', { stoneCharge: -1n }],
    ['an unknown metal', { metal: 'PLATINUM' as 'GOLD' }],
    ['an unknown purity', { purity: 'K24' as PurityKey }],
  ])('rejects %s', (_name, over) => {
    expect(() => calculateLine(line(over), RATES.K22_916)).toThrow(PricingError);
  });

  it('rejects a float stone charge — money is never a float', () => {
    expect(() =>
      calculateLine(line({ stoneCharge: 1500 as unknown as bigint }), RATES.K22_916),
    ).toThrow(PricingError);
  });

  it('rejects a negative rate', () => {
    expect(() => calculateLine(line(), -1n)).toThrow(PricingError);
  });

  it('names the offending field, so a form can show it', () => {
    expect(() => calculateLine(line({ weightMg: -1 }), RATES.K22_916)).toThrow(
      /weightMg/,
    );
    expect(() => calculateLine(line({ makingPct: 101 }), RATES.K22_916)).toThrow(
      /makingPct/,
    );
  });
});

// ──────────────────────────────────────────────────── the sum invariant

describe('the sum invariant — "the property that must never break"', () => {
  /**
   * §5 TEST: "for 100 random item sets, assert grandTotal === sum(lineTotals) exactly."
   *
   * Seeded rather than `Math.random`, so a failure is reproducible. A property test that
   * cannot be replayed reports a bug you then cannot find.
   */
  function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
  }

  it('holds for 100 random item sets', () => {
    const random = seededRandom(20260805);

    for (let run = 0; run < 100; run += 1) {
      const count = 1 + Math.floor(random() * 20);

      const lines: LineInput[] = Array.from({ length: count }, () => {
        const purity = PURITIES[Math.floor(random() * PURITIES.length)] as PurityKey;
        return {
          metal: purity === 'SILVER_999' ? 'SILVER' : 'GOLD',
          purity,
          weightMg: Math.floor(random() * 200_000),
          // Two decimals, the precision Prisma stores.
          makingPct: Math.round(random() * 10_000) / 100,
          stoneCharge: BigInt(Math.floor(random() * 5_000_000)),
          gstPct: Math.round(random() * 500) / 100,
        };
      });

      const total = calculateTotal(lines, RATES);
      const summed = total.lines.reduce((sum, l) => sum + l.lineTotal, 0n);

      expect(total.grandTotal).toBe(summed);
      expect(total.subtotal + total.totalGst).toBe(total.grandTotal);
    }
  });

  it('the GST plug never drifts more than a paise from the exact value', () => {
    const random = seededRandom(99);

    for (let run = 0; run < 200; run += 1) {
      const input = line({
        weightMg: Math.floor(random() * 500_000),
        makingPct: Math.round(random() * 10_000) / 100,
        stoneCharge: BigInt(Math.floor(random() * 1_000_000)),
      });

      const result = calculateLine(input, RATES.K22_916);

      /**
       * `gstAmount` is derived as `lineTotal − subtotal` so the on-screen breakdown always
       * reconciles. This asserts that convenience never becomes a licence: the reported
       * GST stays within one paise of `subtotal × gstPct/100`, so the plug cannot quietly
       * absorb a real arithmetic error.
       */
      const exactGstScaled = result.subtotal * 300n; // gstPct 3 → 300 basis points
      const exactGst = divideRoundHalfEven(exactGstScaled, 10_000n);
      const drift = result.gstAmount - exactGst;

      expect(drift >= -1n && drift <= 1n).toBe(true);
    }
  });

  it('an empty item list totals zero rather than throwing', () => {
    const total = calculateTotal([], RATES);

    expect(total.grandTotal).toBe(0n);
    expect(total.lines).toHaveLength(0);
  });

  it('20 items — the §5.3 maximum — total correctly', () => {
    const lines = Array.from({ length: 20 }, () => line());
    const total = calculateTotal(lines, RATES);

    const one = calculateLine(line(), RATES.K22_916);
    expect(total.grandTotal).toBe(one.lineTotal * 20n);
  });

  it('rejects a line whose purity has no rate rather than pricing it at zero', () => {
    const partial = { K22_916: 1_184_200n } as unknown as RatesByPurity;

    expect(() => calculateTotal([line({ purity: 'SILVER_999' })], partial)).toThrow(
      PricingError,
    );
  });
});

// ──────────────────────────────────────────────────── human input conversion

describe('gramsToMilligrams', () => {
  it.each([
    ['10', 10_000],
    ['10.5', 10_500],
    ['8.475', 8_475],
    ['0.001', 1],
    ['0', 0],
    ['.5', 500],
    ['5.', 5_000],
  ])('%s g → %s mg', (grams, expected) => {
    expect(gramsToMilligrams(grams)).toBe(expected);
  });

  it('is exact where a float multiplication is not', () => {
    // 2.345 * 1000 is 2344.9999999999995 in IEEE-754. Parsing the decimal text sidesteps
    // the whole class of bug rather than papering over this one value with Math.round.
    expect(gramsToMilligrams('2.345')).toBe(2_345);
    expect(gramsToMilligrams('1.005')).toBe(1_005);
    expect(gramsToMilligrams('8.615')).toBe(8_615);
  });

  it.each(['abc', '', '  ', '.', '1.2.3', '-5', '1e3', '10.0001'])(
    'rejects %s',
    (bad) => {
      expect(() => gramsToMilligrams(bad)).toThrow(PricingError);
    },
  );
});

describe('rupeesToPaise', () => {
  it.each([
    ['100', 10_000n],
    ['100.50', 10_050n],
    ['0.01', 1n],
    ['0', 0n],
    ['12345.67', 1_234_567n],
  ])('₹%s → %s paise', (rupees, expected) => {
    expect(rupeesToPaise(rupees)).toBe(expected);
  });

  it('is exact on the classic float failure', () => {
    // 0.1 + 0.2 !== 0.3 is why MASTER-SPEC §4 forbids float money.
    expect(rupeesToPaise('0.1') + rupeesToPaise('0.2')).toBe(rupeesToPaise('0.3'));
  });

  it.each(['abc', '', '.', '1.234', '-5'])('rejects %s', (bad) => {
    expect(() => rupeesToPaise(bad)).toThrow(PricingError);
  });
});

// ──────────────────────────────────────────────────── the flagship separation

describe('the engine only ever sees a true rate', () => {
  it('is pure — same inputs, same output, no clock and no randomness', () => {
    const first = calculateLine(line(), RATES.K22_916);
    const second = calculateLine(line(), RATES.K22_916);

    expect(first).toEqual(second);
  });

  it('has no import path to the ticker jitter', async () => {
    /**
     * MASTER-SPEC §8: the jitter "never touches the DB, never enters a bill, never affects
     * the calculator ... This must be enforced by architecture."
     *
     * Asserted against the file rather than trusted: a future edit that imports the jitter
     * here fails this test rather than quietly mispricing a bangle.
     */
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('lib/pricing.ts', 'utf8');

    // Import statements only — the file is free to *mention* the jitter in a comment
    // explaining why it must never reach here, and matching on prose would forbid that.
    const imports = source
      .split('\n')
      .filter((l) => /^\s*(import|export .* from|const .* = require)\b/.test(l));

    expect(imports.join('\n')).not.toMatch(/jitter/i);
    // Nothing at all, in fact: the engine's purity is what makes it reusable in a client
    // component, a route handler and a PDF renderer alike.
    expect(imports).toHaveLength(0);
  });
});
