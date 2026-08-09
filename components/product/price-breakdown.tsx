/**
 * The live price block.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.2).
 *
 * §6.2: "Transparency here is the differentiator. Most jewellery sites show one opaque
 * number; showing the working builds trust."
 *
 * Every figure is computed server-side from `lib/pricing.ts` against the rate in
 * `MetalRate` — the same engine the calculator and the Phase 8 bill use, so a customer who
 * checks one against the other finds they agree.
 *
 * A server component. There is nothing interactive here, and the numbers must be in the
 * HTML for the crawler and for the first paint.
 */
import { RateDisclaimer } from '@/components/rates/rate-disclaimer';
import { formatINR } from '@/lib/money';
import type { LineResult } from '@/lib/pricing';
import { cn } from '@/lib/utils/cn';

export interface PriceBreakdownProps {
  price: LineResult;
  weightMg: number;
  ratePerGram: bigint;
  makingPct: number;
  gstPct: number;
  /** ISO timestamp of the rate this price was computed from, for the disclaimer. */
  effectiveAt: string;
  className?: string;
}

/** `8.500` — three decimals, the precision MASTER-SPEC §4 stores. */
function grams(weightMg: number): string {
  return (weightMg / 1000).toFixed(3);
}

export function PriceBreakdown({
  price,
  weightMg,
  ratePerGram,
  makingPct,
  gstPct,
  effectiveAt,
  className,
}: PriceBreakdownProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/*
        A description list, not a table: this is label/value pairs, and a screen reader
        announcing "Metal value, ₹61,540" is exactly right. `tabular` aligns the digits so
        the column reads as a column — §6 DESIGN asks for it to be scannable and aligned.
      */}
      <dl className="flex flex-col gap-4 text-body">
        <Row
          label="Metal value"
          detail={`${grams(weightMg)} g × ${formatINR(ratePerGram)}/g`}
          value={price.metalValue}
        />
        <Row label="Making charges" detail={`${makingPct}%`} value={price.makingCharge} />
        <Row label="Stone / other" value={price.stoneCharge} />
        <Row label={`GST (${gstPct}%)`} value={price.gstAmount} />

        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-4">
          <dt className="text-h3 font-semibold text-ink">Total</dt>
          <dd
            className="text-h2 font-semibold text-ink tabular"
            data-testid="product-total"
          >
            {formatINR(price.lineTotal, true)}
          </dd>
        </div>
      </dl>

      {/*
        §6.2 requires this line, and §9.6 requires "a rate disclaimer on the homepage,
        /rates, and every product page".

        It used to be a bespoke sentence — "Price indicative · based on today's rate" — which
        is exactly the drift Phase 4 created `RateDisclaimer` to prevent: it dropped **"Final
        price confirmed in store"**, the half of the notice that does the work. MASTER-SPEC §8
        treats the disclaimer as the mitigation for showing a price the shop will not
        necessarily transact at, and the product page is where a customer is closest to
        acting on the figure — so it had the weakest wording in the place it mattered most.

        One component, three surfaces. §4.6's reasoning applies verbatim: "two copies of a
        legal notice drift within a month," and this one drifted in two.
      */}
      <RateDisclaimer effectiveAt={effectiveAt} />
    </div>
  );
}

function Row({
  label,
  detail,
  value,
}: {
  label: string;
  detail?: string;
  value: bigint;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="min-w-0 text-muted">
        {label}
        {detail && (
          // The working, not just the answer. This is the part §6.2 calls the
          // differentiator — anyone can check 8.500 × ₹11,842 themselves.
          //
          // Full-strength `muted`, not `/80`: the alpha took it to 3.43:1 on the card's
          // white (§9.7). §6.2's whole argument is that a customer can CHECK this line, so
          // it is the last text in the application that should be hard to read.
          <span className="block text-small text-muted tabular">{detail}</span>
        )}
      </dt>
      {/*
        Paise shown, not whole rupees.

        §6.2's illustration rounds to rupees, but rounded components do not add up to a
        rounded total: on the Temple Necklace Set they sum to ₹7,47,251 beside a stated
        ₹7,47,252. A visible ₹1 gap in a block whose entire purpose is "showing the working
        builds trust" defeats the block, and it is precisely the discrepancy MASTER-SPEC §4
        exists to prevent. §6 DESIGN asking for the column to be "aligned on the decimal"
        points the same way.
      */}
      <dd className="shrink-0 text-ink tabular">{formatINR(value, true)}</dd>
    </div>
  );
}
