/**
 * Full breakdown sheet.
 * Created by Phase 5 (specs/05-calculator.md §5.4) — "Chevron to expand a full breakdown".
 *
 * The one screen where a customer checks the arithmetic, so every figure is shown to the
 * paise and the lines are laid out to add up in the order they are read.
 */
'use client';

import { Sheet } from '@/components/ui';
import { summariseTotal } from '@/lib/calculator/summary';
import type { CalculatorItem } from '@/lib/calculator/types';
import { formatINR } from '@/lib/money';
import type { TotalResult } from '@/lib/pricing';

export function TotalSheet({
  open,
  onOpenChange,
  items,
  total,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CalculatorItem[];
  total: TotalResult | null;
}) {
  const summary = total ? summariseTotal(total) : null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Price breakdown"
      description="Indicative. Final price confirmed in store."
    >
      {total && summary && total.lines.length > 0 ? (
        <div className="flex flex-col gap-6">
          <ul className="flex flex-col gap-4">
            {total.lines.map((line, index) => {
              // `total.lines` holds only the items that priced, in order, so the label
              // comes from the same position in the priceable subset.
              const item = items[index];
              return (
                <li
                  key={item?.id ?? index}
                  className="flex items-baseline justify-between gap-4 border-b border-line pb-4 last:border-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium text-ink">
                      {item?.label.trim() || `Item ${index + 1}`}
                    </span>
                    <span className="block text-small text-muted">
                      {item?.weightGrams || 0} g · making {item?.makingPct || 0}%
                    </span>
                  </span>
                  <span className="shrink-0 text-body font-semibold text-ink num">
                    {formatINR(line.lineTotal, true)}
                  </span>
                </li>
              );
            })}
          </ul>

          {/*
            Brief §16: metal value, making charges, stone charges, GST and TOTAL, separated.

            Phase 5 showed Subtotal → GST → Grand total, which is the arithmetic but not the
            explanation: a customer asking "why does 48 g of gold cost this?" could not see
            what was metal and what was labour. Every figure here is summed from the engine's
            own per-line results — `summariseTotal` does no arithmetic of its own, and
            `summary.test.ts` asserts the parts reconcile with the total beneath them.
          */}
          <dl className="flex flex-col gap-2 text-body">
            <Row label="Metal value" value={summary.metalValue} />
            <Row label="Making charges" value={summary.makingCharge} />
            {/* Hidden rather than shown as ₹0 — a line nobody was charged for is noise. */}
            {summary.hasStoneCharge && (
              <Row label="Stone / other charges" value={summary.stoneCharge} />
            )}
            <Row label="GST" value={summary.gst} />
            <Row label="Total" value={summary.grandTotal} emphasis />
          </dl>

          {/*
            The treatment is settled (DEBT-001 closed), so the copy no longer hedges about
            it. The "estimate, not a tax invoice" line stays, and is now the only claim this
            makes: a calculator result is not a bill, whatever the arithmetic behind it.
          */}
          <p className="text-small text-muted">
            GST is calculated on the metal value plus making charges. This is an estimate,
            not a tax invoice — the final price is confirmed in store.
          </p>
        </div>
      ) : (
        <p className="text-body text-muted">
          Add an item&rsquo;s weight to see a breakdown.
        </p>
      )}
    </Sheet>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: bigint;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? 'mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-4 text-h2 font-semibold text-ink'
          : 'flex items-baseline justify-between gap-4'
      }
    >
      <dt className={emphasis ? undefined : 'text-muted'}>{label}</dt>
      <dd className="num">{formatINR(value, true)}</dd>
    </div>
  );
}
