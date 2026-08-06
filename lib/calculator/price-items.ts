/**
 * Price a list of form items, tolerating the ones that are mid-edit.
 * Created by Phase 5 (specs/05-calculator.md §5.4); extracted for reuse by Phase 8 §8.1.
 *
 * §8.1: "Reuse the Phase 5 calculator components. **Do not fork them.** Extract any shared
 * piece into `components/calculator/` and import from both. Two diverging pricing UIs is a
 * future defect factory."
 *
 * This was a private function inside `calculator.tsx`. The bill builder needs exactly the
 * same behaviour — a row with a typo in it must not stop the others from totalling — and
 * copying twenty lines is how the two screens start quoting different numbers.
 *
 * No React, no `server-only`: it is a pure function over form state, so a unit test does
 * not need to render anything.
 */
import type { CalculatorItem, FieldErrors } from '@/lib/calculator/types';
import { toLineInput } from '@/lib/calculator/types';
import {
  calculateTotal,
  type LineInput,
  type LineResult,
  type RatesByPurity,
  type TotalResult,
} from '@/lib/pricing';

export interface PricedItems {
  /** Null until rates are available. */
  total: TotalResult | null;
  results: Map<string, LineResult>;
  errors: Map<string, FieldErrors>;
}

/**
 * Price every item that currently converts, and collect field errors for those that do not.
 *
 * Someone pricing eight pieces should not lose the running total because they are half-way
 * through typing the ninth.
 */
export function priceItems(
  items: CalculatorItem[],
  rates: RatesByPurity | null,
): PricedItems {
  const errors = new Map<string, FieldErrors>();
  const results = new Map<string, LineResult>();

  if (!rates) return { total: null, results, errors };

  const priceable: { id: string; input: LineInput }[] = [];

  for (const item of items) {
    const converted = toLineInput(item);
    if (converted.ok) {
      priceable.push({ id: item.id, input: converted.input });
    } else {
      errors.set(item.id, converted.errors);
    }
  }

  const total = calculateTotal(
    priceable.map((entry) => entry.input),
    rates,
  );

  priceable.forEach((entry, index) => {
    const line = total.lines[index];
    if (line) results.set(entry.id, line);
  });

  return { total, results, errors };
}
