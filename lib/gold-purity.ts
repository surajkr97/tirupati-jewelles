/**
 * Gold purity derivation — one typed rate, two hallmarked rates.
 * Added by the "single gold field" change to /admin/rates.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  The shop reads ONE number off the market every morning: the 24K (pure) gold rate.
 *  916 and 750 are not independent facts about the world — they are that number times a
 *  fineness. Asking an admin to type both invites the one error the arithmetic cannot
 *  have: a 22K rate and an 18K rate that do not describe the same metal, silently pricing
 *  half the catalogue off a stale figure.
 *
 *  So the admin types 24K and this module derives the rest. `lib/rates.ts` still writes a
 *  `MetalRate` row PER PURITY, because bills snapshot per purity and the history table is
 *  an audit trail — the storage shape does not change, only how many numbers a human has
 *  to be right about.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NOT `server-only`, deliberately, and string literals rather than the Prisma enum — the
 * rate editor is a client component and shows the admin the derived figures as they type.
 * Same split, and the same reason, as `lib/rates.keys.ts` and `lib/pricing.ts`.
 */

/** The two hallmarked gold purities the shop sells. 24K is quoted, never sold. */
export const GOLD_PURITIES = ['K22_916', 'K18_750'] as const;
export type GoldPurityKey = (typeof GOLD_PURITIES)[number];

/**
 * Parts of pure gold per thousand — what the hallmark number literally means.
 *
 * 916 is 91.6% pure, 750 is 75.0%. The derivation is therefore `pure × fineness / 1000`,
 * which is the formula on every dealer's board: 22K = 24K × 0.916.
 *
 * A jeweller who prefers a different basis (some quote 22K against 999-fine gold rather
 * than a notional 1000) changes it here, once, and both the editor's live preview and the
 * stored rate move together — which is the point of it being one table.
 */
export const FINENESS_BASE = 1000n;

export const GOLD_FINENESS: Record<GoldPurityKey, bigint> = {
  K22_916: 916n,
  K18_750: 750n,
};

/** How each derived purity is named to the admin. */
export const GOLD_PURITY_LABELS: Record<GoldPurityKey, string> = {
  K22_916: '22K (916)',
  K18_750: '18K (750)',
};

/**
 * 24K → 916 / 750.
 *
 * Unit-agnostic: the ratio is linear, so paise-per-gram in gives paise-per-gram out and
 * paise-per-10g in gives paise-per-10g out. The editor uses the display unit, `setGoldRates`
 * uses per-gram, and both get the same arithmetic.
 *
 * Rounded half-up rather than truncated. Truncation biases every derived rate downward by
 * up to a paise per gram, and it does so on every save forever — a systematic discount is
 * worse than a rounding, even a sub-paise one.
 */
export function goldRateFromPure(pure: bigint, purity: GoldPurityKey): bigint {
  const fineness = GOLD_FINENESS[purity];
  return (pure * fineness + FINENESS_BASE / 2n) / FINENESS_BASE;
}

/**
 * 916 / 750 → 24K. The inverse.
 *
 * Needed because no 24K rate is STORED — there is no `K24` in the `Purity` enum and adding
 * one would let a product be created at a purity the shop does not sell. The editor shows
 * back the pure rate implied by the live 22K row, so the field an admin returns to is
 * pre-filled with the number they last typed rather than blank.
 *
 * NOT an exact inverse, and it cannot be. Rates are stored as integer paise per gram, so
 * `goldRateFromPure` discards up to half a paise per gram and there is nothing left to
 * recover it from. Measured across ₹5,000–₹50,000 per gram the round trip lands within one
 * paise per gram of the original. Use `quotedPureRate` for anything a human reads.
 */
export function pureFromGoldRate(rate: bigint, purity: GoldPurityKey): bigint {
  const fineness = GOLD_FINENESS[purity];
  return (rate * FINENESS_BASE + fineness / 2n) / fineness;
}

/** Paise in a rupee. The granularity gold is actually quoted at. */
const PAISE_PER_RUPEE = 100n;

/**
 * The 24K rate to show an admin, in the display unit (paise per 10g), snapped to the rupee.
 *
 * ── Why the snap is not laziness ──
 * `pureFromGoldRate` drifts by up to a paise per gram, which is ten paise per 10 grams, and
 * the editor pre-fills its field from this. Without the snap an admin who typed `129000`
 * yesterday opens the page today and reads `129000.05` — a number they did not type, in the
 * one field in the application where "that isn't what I entered" should never happen. The
 * figure is cosmetic drift from integer storage, but it does not look cosmetic; it looks
 * like the app is doing something to their rate behind their back.
 *
 * Snapping to the rupee is safe because that is the granularity gold is quoted at — no
 * dealer board in India prices 10 grams to the paise. Half a rupee per 10g is five paise per
 * gram of PURE gold, under five paise per gram once the fineness is applied, and the stored
 * rows keep whatever the admin actually typed. Nothing computes on this value; it only
 * decides what the field says when the page loads.
 */
export function quotedPureRate(displayRate: bigint, purity: GoldPurityKey): bigint {
  const pure = pureFromGoldRate(displayRate, purity);
  return ((pure + PAISE_PER_RUPEE / 2n) / PAISE_PER_RUPEE) * PAISE_PER_RUPEE;
}
