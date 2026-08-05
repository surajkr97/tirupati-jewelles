/**
 * Ticker jitter — presentation only.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.3, MASTER-SPEC §8).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS VALUE IS NEVER MONEY.
 *
 *  It exists to make the homepage rate card feel live. It never reaches the database,
 *  never enters a bill, never touches the calculator. §4: "If you find yourself passing
 *  it as a prop, you have made a mistake."
 *
 *  Kept as a pure function here — separate from the component — so the ±2% clamp can be
 *  proven over 10,000 ticks (§4 TEST) rather than eyeballed in a browser.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Why the clamp matters: an unbounded random walk drifts. A tab left open for an hour
 * would show a gold rate thousands of rupees from the real one, which is both absurd and
 * exactly the consumer-protection exposure MASTER-SPEC §8 describes.
 */

/** ±₹101–199 per tick, as the client specified. In paise. */
export const JITTER_MIN_PAISE = 101_00;
export const JITTER_MAX_PAISE = 199_00;

/** The displayed value may never drift further than this from the true rate. */
export const JITTER_CLAMP = 0.02;

export const TICK_INTERVAL_MS = 1000;

export interface Tick {
  /** Display value in paise, always within ±2% of `truth`. */
  value: bigint;
  direction: 'up' | 'down' | 'flat';
}

/**
 * One step of the walk.
 *
 * @param current  the value currently displayed, in paise
 * @param truth    the true rate in the same unit — the clamp is measured against this
 * @param random   injectable for deterministic tests; defaults to Math.random
 */
export function nextTick(
  current: bigint,
  truth: bigint,
  random: () => number = Math.random,
): Tick {
  if (truth <= 0n) return { value: truth, direction: 'flat' };

  const span = JITTER_MAX_PAISE - JITTER_MIN_PAISE;
  const magnitude = BigInt(JITTER_MIN_PAISE + Math.floor(random() * (span + 1)));
  const up = random() < 0.5;

  const proposed = up ? current + magnitude : current - magnitude;

  // Clamp against the TRUTH, not against the previous displayed value — clamping to the
  // latter would let the walk creep arbitrarily far, one bounded step at a time.
  const maxDrift = (truth * BigInt(Math.round(JITTER_CLAMP * 10_000))) / 10_000n;
  const upper = truth + maxDrift;
  const lower = truth - maxDrift;

  let value = proposed;
  if (value > upper) value = upper;
  if (value < lower) value = lower;

  const direction: Tick['direction'] =
    value > current ? 'up' : value < current ? 'down' : 'flat';

  return { value, direction };
}

/** True when the displayed value is inside the permitted band. Used by the clamp test. */
export function withinClamp(value: bigint, truth: bigint): boolean {
  if (truth <= 0n) return value === truth;
  const maxDrift = (truth * BigInt(Math.round(JITTER_CLAMP * 10_000))) / 10_000n;
  return value >= truth - maxDrift && value <= truth + maxDrift;
}
