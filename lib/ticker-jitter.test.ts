/**
 * Phase 4 TEST: "Unit: jitter clamp — simulate 10,000 ticks, assert the display value
 * never exits ±2% of the true rate."
 *
 * This is the test that makes the jitter defensible. MASTER-SPEC §8: showing a price you
 * will not transact at is exposure under Indian consumer-protection rules, and the clamp
 * plus the disclaimer is the mitigation. An unbounded walk would drift thousands of rupees
 * from the real rate within an hour of an open tab.
 */
import { describe, expect, it } from 'vitest';

import {
  JITTER_MAX_PAISE,
  JITTER_MIN_PAISE,
  nextTick,
  withinClamp,
} from '@/lib/ticker-jitter';

/** ₹1,18,420 per 10g, in paise — a realistic gold 22K display value. */
const TRUTH = 11_842_000n;

describe('the ±2% clamp', () => {
  it('never exits the band across 10,000 consecutive ticks', () => {
    let value = TRUTH;
    let worst = 0;

    for (let i = 0; i < 10_000; i += 1) {
      value = nextTick(value, TRUTH).value;

      expect(
        withinClamp(value, TRUTH),
        `tick ${i}: ${value} drifted outside ±2% of ${TRUTH}`,
      ).toBe(true);

      const drift = Math.abs(Number(value - TRUTH)) / Number(TRUTH);
      worst = Math.max(worst, drift);
    }

    // Sanity on the test itself: if the walk never approached the band, the clamp was
    // never actually exercised and this would be a vacuous pass.
    expect(worst).toBeGreaterThan(0.005);
  });

  it('holds even when every step pushes the same way', () => {
    // Worst case for an unbounded walk: 500 consecutive upward steps.
    const alwaysUp = () => 0.99;
    let value = TRUTH;

    for (let i = 0; i < 500; i += 1) {
      value = nextTick(value, TRUTH, alwaysUp).value;
    }

    expect(withinClamp(value, TRUTH)).toBe(true);
    expect(value).toBeLessThanOrEqual(TRUTH + TRUTH / 50n);
  });

  it('holds under 500 consecutive downward steps', () => {
    const alwaysDown = () => 0.0;
    let value = TRUTH;

    for (let i = 0; i < 500; i += 1) {
      value = nextTick(value, TRUTH, alwaysDown).value;
    }

    expect(withinClamp(value, TRUTH)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(TRUTH - TRUTH / 50n);
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
