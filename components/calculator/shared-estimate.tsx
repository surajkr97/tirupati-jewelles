/**
 * A shared estimate, rendered read-only.
 * Created by Phase 5 (specs/05-calculator.md §5.5).
 *
 * A server component with no interactivity at all. The recipient is reading a quote, not
 * editing one — anything they changed would be priced against a stale snapshot and become
 * a number nobody quoted them. "Price your own pieces" sends them to the live calculator
 * instead.
 */
import { Card } from '@/components/ui';
import type { CalculatorItem } from '@/lib/calculator/types';
import { formatINR } from '@/lib/money';
import { PURITY_OPTIONS } from '@/lib/calculator/types';
import type { TotalResult } from '@/lib/pricing';

export function SharedEstimate({
  items,
  total,
}: {
  items: CalculatorItem[];
  total: TotalResult;
}) {
  return (
    <Card className="flex flex-col gap-6">
      <ul className="flex flex-col gap-4">
        {total.lines.map((line, index) => {
          const item = items[index];
          const purity = PURITY_OPTIONS.find((o) => o.value === item?.purity);

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
                  {purity?.label ?? ''} · {item?.weightGrams || 0} g · making{' '}
                  {item?.makingPct || 0}%
                  {item && item.stoneCharge.trim() !== ''
                    ? ` · stones ₹${item.stoneCharge}`
                    : ''}
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
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">Subtotal</dt>
          <dd className="tabular">{formatINR(total.subtotal, true)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">GST</dt>
          <dd className="tabular">{formatINR(total.totalGst, true)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2 text-h2 font-semibold text-ink">
          <dt>Total</dt>
          <dd className="tabular" data-testid="shared-grand-total">
            {formatINR(total.grandTotal, true)}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
