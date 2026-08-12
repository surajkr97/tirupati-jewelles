/**
 * Phase 4 TEST: "Unit: jitter clamp — simulate 10,000 ticks, assert the display value
 * never exits the band." Stage 6 replaced that band: ±2% became a flat ±₹199 at the owner's
 * instruction, because 2% of the real gold rate is ₹2,368 and the exposure MASTER-SPEC §8
 * describes is measured in rupees, not in percent.
 *
 * This is the test that makes the jitter defensible. §8: showing a price you will not
 * transact at is exposure under Indian consumer-protection rules, and the band plus the
 * disclaimer is the mitigation. An unbounded walk would drift thousands of rupees from the
 * real rate within an hour of an open tab.
 */
import { describe, expect, it } from 'vitest';

import {
  JITTER_BAND_PAISE,
  JITTER_MAX_PAISE,
  JITTER_MIN_PAISE,
  nextTick,
  TICK_INTERVAL_MS,
  withinClamp,
} from '@/lib/ticker-jitter';

/** ₹1,18,420 per 10g, in paise — a realistic gold 22K display value. */
const TRUTH = 11_842_000n;

describe('the ±₹199 band', () => {
  it('never exits the band across 10,000 consecutive ticks', () => {
    let value = TRUTH;
    let worst = 0n;

    for (let i = 0; i < 10_000; i += 1) {
      value = nextTick(value, TRUTH).value;

      const drift = value > TRUTH ? value - TRUTH : TRUTH - value;
      expect(
        drift <= BigInt(JITTER_BAND_PAISE),
        `tick ${i}: ${value} is ${drift} paise from ${TRUTH}, past ±₹199`,
      ).toBe(true);

      if (drift > worst) worst = drift;
    }

    // Sanity on the test itself: if the walk never approached the edge, the bound was never
    // actually exercised and this would be a vacuous pass.
    expect(Number(worst)).toBeGreaterThan(JITTER_BAND_PAISE * 0.5);
  });

  it('is a flat rupee band, not a percentage of the rate', () => {
    /**
     * The regression this pins. ±2% of ₹1,18,420 is ₹2,368 — the card was free to show a
     * rate that far from the one the shop transacts at, and the more expensive the metal the
     * wider the lie got. A flat band does not scale with the rate.
     */
    const cheap = 1_000_000n; // ₹10,000
    const dear = 100_000_000n; // ₹10,00,000

    for (const truth of [cheap, dear]) {
      let value = truth;
      let worst = 0n;
      for (let i = 0; i < 2_000; i += 1) {
        value = nextTick(value, truth).value;
        const drift = value > truth ? value - truth : truth - value;
        if (drift > worst) worst = drift;
      }
      expect(Number(worst)).toBeLessThanOrEqual(JITTER_BAND_PAISE);
    }
  });

  it('keeps moving at the edge instead of freezing there', () => {
    /**
     * A step is ₹101–199 inside a ₹398-wide band, so a walk that CLAMPED would land on an
     * edge and then re-clamp to the same number — a "live" ticker showing an unchanging
     * value. Reflection is what prevents that, and this is the test that would catch it
     * being swapped back for a clamp.
     */
    let value = TRUTH;
    let flat = 0;
    for (let i = 0; i < 2_000; i += 1) {
      const tick = nextTick(value, TRUTH);
      if (tick.direction === 'flat') flat += 1;
      value = tick.value;
    }
    expect(flat, 'the ticker must never render the same number twice in a row').toBe(0);
  });

  it('ticks every 3 seconds', () => {
    // One second read as a stock ticker on what is a once-a-day shop rate.
    expect(TICK_INTERVAL_MS).toBe(3000);
  });

  it('holds even when every step pushes the same way', () => {
    // Worst case for an unbounded walk: 500 consecutive upward steps.
    const alwaysUp = () => 0.99;
    let value = TRUTH;

    for (let i = 0; i < 500; i += 1) {
      value = nextTick(value, TRUTH, alwaysUp).value;
    }

    expect(withinClamp(value, TRUTH)).toBe(true);
    expect(value).toBeLessThanOrEqual(TRUTH + BigInt(JITTER_BAND_PAISE));
  });

  it('holds under 500 consecutive downward steps', () => {
    const alwaysDown = () => 0.0;
    let value = TRUTH;

    for (let i = 0; i < 500; i += 1) {
      value = nextTick(value, TRUTH, alwaysDown).value;
    }

    expect(withinClamp(value, TRUTH)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(TRUTH - BigInt(JITTER_BAND_PAISE));
  });

  it('clamps against the truth, not the previous displayed value', () => {
    // Starting far outside the band, one tick must pull back inside — clamping relative
    // to `current` instead would let the walk creep away one bounded step at a time.
    const stray = TRUTH * 2n;
    expect(withinClamp(nextTick(stray, TRUTH).value, TRUTH)).toBe(true);
  });
});

describe('step magnitude — the client asked for ±₹101–199', () => {
  it('moves between ₹101 and ₹199 per tick while inside the band', () => {
    let value = TRUTH;

    for (let i = 0; i < 200; i += 1) {
      const before = value;
      value = nextTick(value, TRUTH).value;

      const step = Number(value > before ? value - before : before - value);
      // Skip clamped ticks, which are truncated by design.
      if (!withinClamp(before, TRUTH)) continue;
      if (step === 0) continue;

      expect(step).toBeLessThanOrEqual(JITTER_MAX_PAISE);
      if (step < JITTER_MIN_PAISE) {
        // Only legitimate when the clamp truncated the step at the edge of the band.
        expect(withinClamp(value, TRUTH)).toBe(true);
      }
    }
  });

  it('moves in both directions over a run', () => {
    let value = TRUTH;
    const directions = new Set<string>();

    for (let i = 0; i < 200; i += 1) {
      const tick = nextTick(value, TRUTH);
      value = tick.value;
      directions.add(tick.direction);
    }

    expect(directions.has('up')).toBe(true);
    expect(directions.has('down')).toBe(true);
  });
});

describe('degenerate input', () => {
  it('returns the truth unchanged when there is no rate', () => {
    expect(nextTick(0n, 0n)).toEqual({ value: 0n, direction: 'flat' });
  });

  it('never produces a negative display value', () => {
    let value = 100_00n;
    for (let i = 0; i < 1_000; i += 1) {
      value = nextTick(value, 100_00n).value;
      expect(value).toBeGreaterThan(0n);
    }
  });
});
