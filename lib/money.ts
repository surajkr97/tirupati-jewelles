/**
 * Money formatting — paise to rupees, at the last possible moment.
 * Created by Phase 4. Rules from MASTER-SPEC §4.
 *
 * "All money is stored and computed as integer paise. Never float. Never `number` for
 * currency. Format for display only at the last moment, via formatINR(paise: bigint)."
 *
 * Formatting is the one place a rounding decision is safe, because nothing downstream
 * computes on the result.
 */

/**
 * Format paise as Indian rupees with lakh/crore grouping.
 *
 * @param paise      integer paise
 * @param showPaise  include decimals. Off by default: rate cards and product prices are
 *                   quoted in whole rupees, and `₹1,18,420.00` is noise. Bills turn it on.
 */
export function formatINR(paise: bigint, showPaise = false): string {
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;

  const rupees = absolute / 100n;
  const remainder = absolute % 100n;

  // Intl handles the 2,2,3 Indian digit grouping; bigint is safe here because the value
  // is already whole rupees and we never do arithmetic on the output.
  const grouped = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(rupees);

  const decimals = showPaise ? `.${remainder.toString().padStart(2, '0')}` : '';

  return `${negative ? '-' : ''}₹${grouped}${decimals}`;
}

/** Signed, for deltas: `▲ ₹142`. The caller supplies the arrow so colour and glyph agree. */
export function formatDelta(paise: bigint): string {
  const absolute = paise < 0n ? -paise : paise;
  return formatINR(absolute);
}

/**
 * Percentage change, as a display string.
 *
 * `Number()` on a bigint is safe at this magnitude — a rate would have to exceed
 * 2^53 paise (about ₹90 trillion) to lose precision, and this value is only ever rendered.
 */
export function formatPercent(change: bigint, base: bigint): string {
  if (base === 0n) return '0.00%';
  const pct = (Number(change) / Number(base)) * 100;
  return `${Math.abs(pct).toFixed(2)}%`;
}

/** Grams from integer milligrams, for display. */
export function formatGrams(milligrams: number): string {
  return (milligrams / 1000).toFixed(3).replace(/\.?0+$/, '');
}
