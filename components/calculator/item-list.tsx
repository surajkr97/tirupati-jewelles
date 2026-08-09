/**
 * The list of priced item cards, plus the add button.
 * Created by Phase 5 (§5.4); extracted for reuse by Phase 8 (§8.1).
 *
 * §8.1: "Reuse the Phase 5 calculator components. **Do not fork them.** Extract any shared
 * piece into `components/calculator/` and import from both."
 *
 * The customer calculator and the admin bill builder render an identical stack of cards —
 * same layout, same limit, same add affordance — and differ only in what surrounds them.
 * That difference belongs to the callers; everything here is the part they share.
 */
'use client';

import { Plus } from 'lucide-react';

import { ItemCard } from '@/components/calculator/item-card';
import { MAX_ITEMS } from '@/lib/calculator/reducer';
import type { CalculatorItem, FieldErrors } from '@/lib/calculator/types';
import type { LineResult } from '@/lib/pricing';

export interface ItemListProps {
  items: CalculatorItem[];
  results: Map<string, LineResult>;
  errors: Map<string, FieldErrors>;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<Omit<CalculatorItem, 'id'>>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  /**
   * Extra fields inside a card — Phase 8's per-item hallmark and BIS numbers (§8.3).
   *
   * A render prop rather than a `mode="bill"` flag: the calculator passes nothing and its
   * card is byte-for-byte what Phase 5 shipped, so the shared component cannot grow a
   * branch that only one caller exercises.
   */
  renderExtra?: (item: CalculatorItem) => React.ReactNode;
}

export function ItemList({
  items,
  results,
  errors,
  onAdd,
  onChange,
  onRemove,
  onDuplicate,
  renderExtra,
}: ItemListProps) {
  const atLimit = items.length >= MAX_ITEMS;

  return (
    <>
      <ul className="flex flex-col gap-4">
        {items.map((item, index) => (
          <li key={item.id}>
            <ItemCard
              item={item}
              index={index}
              result={results.get(item.id) ?? null}
              errors={errors.get(item.id) ?? {}}
              canRemove={items.length > 1}
              onChange={(patch) => onChange(item.id, patch)}
              onRemove={() => onRemove(item.id)}
              onDuplicate={() => onDuplicate(item.id)}
              extra={renderExtra?.(item)}
            />
          </li>
        ))}
      </ul>

      {/* §5.4: "Prominent + Add another item button below the last card, full width,
          dashed outline." */}
      <button
        type="button"
        onClick={onAdd}
        disabled={atLimit}
        className="flex h-control-lg w-full items-center justify-center gap-2 rounded-card border-2 border-dashed border-line text-body font-semibold text-taupe-deep transition-colors duration-fast ease-standard hover:border-taupe hover:bg-taupe-lt/20 disabled:opacity-40"
      >
        <Plus className="size-icon" aria-hidden="true" />
        Add another item
      </button>

      {atLimit && (
        <p className="text-center text-small text-muted">
          You can price {MAX_ITEMS} items at once.
        </p>
      )}
    </>
  );
}
