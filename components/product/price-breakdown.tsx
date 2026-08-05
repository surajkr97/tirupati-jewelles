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
import { formatINR } from '@/lib/money';
import type { LineResult } from '@/lib/pricing';
import { cn } from '@/lib/utils/cn';

export interface PriceBreakdownProps {
  price: LineResult;
  weightMg: number;
  ratePerGram: bigint;
  makingPct: number;
  gstPct: number;
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
  className,
}: PriceBreakdownProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/*
        A description list, not a table: this is label/value pairs, and a screen reader
        announcing "Metal value, ₹61,540" is exactly right. `tabular` aligns the digits so
        the column reads as a column — §6 DESIGN asks for it to be scannable and aligned.
      */}
      <dl className="flex flex-col gap-3 text-body">
        <Row
          label="Metal value"
          detail={`${grams(weightMg)} g × ${formatINR(ratePerGram)}/g`}
          value={price.metalValue}
        />
        <Row label="Making charges" detail={`${makingPct}%`} value={price.makingCharge} />
        <Row label="Stone / other" value={price.stoneCharge} />
        <Row label={`GST (${gstPct}%)`} value={price.gstAmount} />

        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
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
        §6.2 requires this line. It is the same mitigation MASTER-SPEC §8 relies on for the
        ticker: the price is derived from a rate that moves, so it is described as
        indicative rather than quoted.
      */}
      <p className="text-small text-muted">
        Price indicative · based on today&rsquo;s rate
      </p>
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
          <span className="block text-small text-muted/80 tabular">{detail}</span>
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
