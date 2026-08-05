/**
 * Full breakdown sheet.
 * Created by Phase 5 (specs/05-calculator.md §5.4) — "Chevron to expand a full breakdown".
 *
 * The one screen where a customer checks the arithmetic, so every figure is shown to the
 * paise and the lines are laid out to add up in the order they are read.
 */
'use client';

import { Sheet } from '@/components/ui';
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
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Price breakdown"
      description="Indicative. Final price confirmed in store."
    >
      {total && total.lines.length > 0 ? (
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
                  <span className="shrink-0 text-body font-semibold text-ink tabular">
                    {formatINR(line.lineTotal, true)}
                  </span>
                </li>
              );
            })}
          </ul>

          <dl className="flex flex-col gap-2 text-body">
            <Row label="Subtotal" value={total.subtotal} />
            <Row label="GST" value={total.totalGst} />
            <Row label="Grand total" value={total.grandTotal} emphasis />
          </dl>

          {/*
            §5.2: "Note in code that GST treatment of making charges has been contested and
            the client should confirm with their CA. Flag it in DEBT.md — do not present
            the split as tax advice." So this says what was calculated, and does not
            present it as a tax position. DEBT-001.
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
          ? 'flex items-baseline justify-between gap-4 border-t border-line pt-2 text-h3 font-semibold text-ink'
          : 'flex items-baseline justify-between gap-4'
      }
    >
      <dt className={emphasis ? undefined : 'text-muted'}>{label}</dt>
      <dd className="tabular">{formatINR(value, true)}</dd>
    </div>
  );
}
