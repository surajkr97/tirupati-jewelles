/**
 * The CGST / SGST split shown on an invoice.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.3). Closes DEBT-017.
 *
 * §8.3: "Totals: taxable value → CGST 1.5% → SGST 1.5% → grand total".
 * §5.2: "the bill shows the CGST/SGST split; the calculator shows a single 3% line."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS SPLITS A TOTAL. IT DOES NOT COMPUTE ONE.
 *
 *  The GST amount arrives already computed by `lib/pricing.ts` and already stored on the
 *  order. Halving it here — rather than applying 1.5% twice to the taxable value — is what
 *  makes §8 TEST's "GST split sums exactly to the total GST" true by construction instead
 *  of by luck: two independent 1.5% roundings can differ from one 3% rounding by a paise,
 *  and a bill whose two tax lines do not add up to its tax total is the kind of thing an
 *  auditor stops on.
 *
 *  The taxable base this divides is settled: making charges are inside it, confirmed by the
 *  client's CA (DEBT-001, closed). See `GST_INCLUDES_MAKING_CHARGES` in lib/pricing.ts.
 *
 *  ⚠ What is NOT handled: an inter-state sale. This splits every bill CGST/SGST, which is
 *  correct for an intra-state supply and wrong for one crossing a state border — that needs
 *  IGST at 3%, undivided. The shop sells over the counter in one state, so the case does not
 *  arise today; it would the first time they ship. Tracked as DEBT-034.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface GstSplit {
  /** Central GST, in paise. */
  cgst: bigint;
  /** State GST, in paise. Carries the odd paise so the two always sum to `total`. */
  sgst: bigint;
  /** The figure that was split — always `cgst + sgst`. */
  total: bigint;
}

/**
 * Halve a GST amount into its central and state components.
 *
 * The remainder goes to SGST rather than being rounded independently. Which half receives
 * the odd paise is arbitrary; that one of them must, and that the choice is made once, is
 * not.
 */
export function splitGst(totalGst: bigint): GstSplit {
  const cgst = totalGst / 2n;
  return { cgst, sgst: totalGst - cgst, total: totalGst };
}

/**
 * The rate to print beside each half, e.g. `1.5` for a 3% bill.
 *
 * Derived from the rate actually applied to the items rather than hardcoded at 1.5, because
 * `gstPct` is a per-item column (MASTER-SPEC §5) and a bill that mixes rates must not claim
 * a single one. Returns null when the items disagree, and the caller prints the amount
 * without a percentage — an unlabelled figure is honest; a wrong label is not.
 */
export function halfRateLabel(gstPercentages: readonly number[]): string | null {
  if (gstPercentages.length === 0) return null;

  const first = gstPercentages[0];
  if (first === undefined) return null;
  if (!gstPercentages.every((pct) => pct === first)) return null;

  const half = first / 2;
  // Two decimals at most, trailing zeros trimmed: 1.5 not 1.50, 0.75 not 0.7500.
  return half.toFixed(2).replace(/\.?0+$/, '');
}
