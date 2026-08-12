/**
 * Ticker jitter — presentation only.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.3, MASTER-SPEC §8).
 * Band and cadence reset by Stage 6 at the shop owner's instruction — see below.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS VALUE IS NEVER MONEY.
 *
 *  It exists to make the homepage rate card feel live. It never reaches the database,
 *  never enters a bill, never touches the calculator. §4: "If you find yourself passing
 *  it as a prop, you have made a mistake."
 *
 *  Kept as a pure function here — separate from the component — so the band can be proven
 *  over 10,000 ticks (§4 TEST) rather than eyeballed in a browser.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Why a band at all: an unbounded random walk drifts. A tab left open for an hour would show
 * a gold rate thousands of rupees from the real one, which is both absurd and exactly the
 * consumer-protection exposure MASTER-SPEC §8 describes.
 *
 * ── Why the band is now ±₹199 flat, and not ±2% ──
 *
 * §4.3 wrote the band as a PERCENTAGE. On the real gold rate — ₹1,18,420 per 10g — 2% is
 * ₹2,368, so the card was free to advertise a rate nearly two and a half thousand rupees off
 * the one the shop will actually transact at. The owner set the ceiling at ₹199 instead.
 *
 * A flat rupee band is also the honest shape for this: the exposure §8 cares about is the
 * gap in RUPEES between what someone reads and what they are charged, and that gap does not
 * get more acceptable because the underlying metal is expensive.
 */

/** ±₹101–199 per step, as the client specified. In paise. */
export const JITTER_MIN_PAISE = 101_00;
export const JITTER_MAX_PAISE = 199_00;

/**
 * The displayed value may never sit further than this from the true rate. In paise.
 *
 * Flat rupees, not a percentage — see the header. ₹199 is the owner's figure.
 */
export const JITTER_BAND_PAISE = 199_00;

/** 3 seconds. One second read as a stock ticker on what is a once-a-day shop rate. */
export const TICK_INTERVAL_MS = 3000;

export interface Tick {
  /** Display value in paise, always within `JITTER_BAND_PAISE` of `truth`. */
  value: bigint;
  direction: 'up' | 'down' | 'flat';
}

/**
 * The half-width of the permitted band for a given truth.
 *
 * Normally just `JITTER_BAND_PAISE`. It narrows only when the true rate is itself smaller
 * than about ₹400, where a flat ±₹199 band would reach zero and below — a percentage band
 * scaled out of that problem for free and a flat one has to be told. No real metal rate is
 * anywhere near that low; this exists so the function is total rather than because the case
 * is expected.
 */
function bandFor(truth: bigint): bigint {
  const half = truth / 2n;
  return half < BigInt(JITTER_BAND_PAISE) ? half : BigInt(JITTER_BAND_PAISE);
}

/**
 * One step of the walk.
 *
 * @param current  the value currently displayed, in paise
 * @param truth    the true rate in the same unit — the band is measured against this
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

  // Measured against the TRUTH, not against the previous displayed value — bounding the
  // latter would let the walk creep arbitrarily far, one bounded step at a time.
  const band = bandFor(truth);
  const upper = truth + band;
  const lower = truth - band;

  /**
   * REFLECT off the edges rather than clamp to them.
   *
   * A step is ₹101–199 and the band is ₹398 wide, so a walk that clamped would spend much
   * of its time pinned to an edge — and a tick that lands on the edge it is already sitting
   * on renders the SAME NUMBER, i.e. a live ticker that visibly stops. Reflecting turns the
   * overshoot back inside, so every tick inside a valid band moves.
   *
   * The final clamp is the guarantee, not the mechanism: it catches a `current` that arrived
   * from outside the band (a rate change under the walk's feet) and any configuration where
   * a single step could exceed the full band width.
   */
  let value = proposed;
  if (value > upper) value = upper - (value - upper);
  if (value < lower) value = lower + (lower - value);
  if (value > upper) value = upper;
  if (value < lower) value = lower;

  const direction: Tick['direction'] =
    value > current ? 'up' : value < current ? 'down' : 'flat';

  return { value, direction };
}

/** True when the displayed value is inside the permitted band. Used by the band test. */
export function withinClamp(value: bigint, truth: bigint): boolean {
  if (truth <= 0n) return value === truth;
  const band = bandFor(truth);
  return value >= truth - band && value <= truth + band;
}
