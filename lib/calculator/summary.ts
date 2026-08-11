/**
 * Aggregate a priced total into the lines the breakdown shows.
 * Created by the UI redesign, Stage 4D (brief §16).
 *
 * ── This is not arithmetic, it is a sum of arithmetic already done ──
 *
 * `calculateTotal` returns a `TotalResult` whose aggregates stop at `subtotal`, `totalGst`
 * and `grandTotal`. Brief §16 asks the summary to separate metal value, making charges,
 * stone charges and GST — figures the engine already computes **per line** and simply does
 * not roll up.
 *
 * So every number here is `+` over values `lib/pricing.ts` produced. Nothing is recomputed
 * from weights or rates, no rounding happens, and no percentage is applied. If this file
 * disappeared the totals would be unchanged; only the breakdown would be coarser.
 *
 * ── Why it is a module and not four `reduce`s inside the sheet ──
 *
 * Because it is money, and money that is displayed has to be provably the same money the
 * engine produced. `summary.test.ts` asserts the parts sum to the engine's own `subtotal`
 * and `grandTotal` across the pricing suite's own fixtures — so if a future engine change
 * makes the parts stop adding to the whole, the test fails instead of the UI quietly
 * showing lines that do not reconcile.
 */
import type { TotalResult } from '@/lib/pricing';

export interface TotalSummary {
  metalValue: bigint;
  makingCharge: bigint;
  stoneCharge: bigint;
  /** Metal + making + stone. Equals `TotalResult.subtotal`. */
  subtotal: bigint;
  gst: bigint;
  grandTotal: bigint;
  /** True when any line carries a stone charge; the row is hidden otherwise. */
  hasStoneCharge: boolean;
}

export function summariseTotal(total: TotalResult): TotalSummary {
  let metalValue = 0n;
  let makingCharge = 0n;
  let stoneCharge = 0n;

  for (const line of total.lines) {
    metalValue += line.metalValue;
    makingCharge += line.makingCharge;
    stoneCharge += line.stoneCharge;
  }

  return {
    metalValue,
    makingCharge,
    stoneCharge,
    // The engine's own figures, not re-derived — see the header.
    subtotal: total.subtotal,
    gst: total.totalGst,
    grandTotal: total.grandTotal,
    hasStoneCharge: stoneCharge > 0n,
  };
}
