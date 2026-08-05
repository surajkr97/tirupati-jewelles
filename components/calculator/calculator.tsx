/**
 * The calculator — flagship feature #2.
 * Created by Phase 5 (specs/05-calculator.md §5.3, §5.4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THIS COMPONENT READS THE TRUE RATE AND NOTHING ELSE.
 *
 *  It fetches `/api/rates`, which serves the value in `MetalRate`. The homepage ticker's
 *  jitter lives in that component's own React state and has no route to a server, so it
 *  cannot reach this screen even while it is visibly running on another tab.
 *
 *  MASTER-SPEC §8: "The calculator and every bill always use the true admin rate, never
 *  the jittered display value. This must be enforced by architecture."
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CSR inside a static shell (MASTER-SPEC §6): the page ships as static HTML and this
 * fetches rates once on mount, then holds them. §5.4 is explicit that they are not
 * refetched — a total must not change under someone mid-edit.
 */
'use client';

import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { ItemCard } from '@/components/calculator/item-card';
import { TotalBar } from '@/components/calculator/total-bar';
import { StickyBar } from '@/components/shell/sticky-bar';
import { TotalSheet } from '@/components/calculator/total-sheet';
import { Button, Skeleton, toast } from '@/components/ui';
import { calculatorReducer, initialState, MAX_ITEMS } from '@/lib/calculator/reducer';
import { clearItems, loadItems, saveItems } from '@/lib/calculator/storage';
import {
  toLineInput,
  type CalculatorItem,
  type FieldErrors,
} from '@/lib/calculator/types';
import { ratesByPurityFromApi } from '@/lib/rates.keys';
import {
  calculateTotal,
  type LineResult,
  type RatesByPurity,
  type TotalResult,
} from '@/lib/pricing';

/** §5.3: "Debounce recalculation by 150ms while typing." */
const DEBOUNCE_MS = 150;

function newId(): string {
  // `randomUUID` needs a secure context; the fallback keeps the calculator working on a
  // plain-http LAN address, which is how the shop will first try it on a phone.
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface CalculatorProps {
  /** Preloaded items — from a product page (§5.6) or a shared link (§5.5). */
  initialItems?: CalculatorItem[];
  /**
   * Rates snapshotted server-side. Supplied when viewing a shared result, where §5.5
   * requires the price NOT to move; omitted on the live calculator, which fetches.
   */
  frozenRates?: RatesByPurity;
}

export function Calculator({ initialItems, frozenRates }: CalculatorProps) {
  const [state, dispatch] = useReducer(
    calculatorReducer,
    initialItems && initialItems.length > 0
      ? { items: initialItems, notice: null }
      : initialState(newId()),
  );

  const [rates, setRates] = useState<RatesByPurity | null>(frozenRates ?? null);
  const [ratesError, setRatesError] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  // A preloaded set is someone else's list; restoring a local draft over it would silently
  // discard the link they just opened.
  const restoreFromStorage = !initialItems;

  /**
   * §5.4: "Rates fetched once on mount from /api/rates, then held."
   *
   * Held, not polled. A total that changes while someone is comparing two options is
   * worse than a total that is five minutes old — and a bill is priced from the server
   * anyway, so this value never has to be authoritative.
   */
  useEffect(() => {
    if (frozenRates) return;

    let cancelled = false;

    fetch('/api/rates')
      .then((response) => {
        if (!response.ok) throw new Error(`/api/rates responded ${response.status}`);
        return response.json();
      })
      .then((payload: unknown) => {
        if (cancelled) return;
        const parsed = ratesByPurityFromApi(payload);
        if (!parsed) throw new Error('Unexpected /api/rates payload');
        setRates(parsed);
      })
      .catch(() => {
        if (!cancelled) setRatesError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [frozenRates]);

  /** §5.3: "Persist to sessionStorage on change; restore on mount." */
  const restored = useRef(false);
  useEffect(() => {
    if (!restoreFromStorage || restored.current) return;
    restored.current = true;

    const saved = loadItems();
    if (saved && saved.length > 0) dispatch({ type: 'RESTORE', items: saved });
  }, [restoreFromStorage]);

  useEffect(() => {
    if (!restoreFromStorage || !restored.current) return;
    saveItems(state.items);
  }, [state.items, restoreFromStorage]);

  /**
   * Debounced snapshot of the items.
   *
   * The pricing itself is microseconds — the debounce is not there for the arithmetic. It
   * stops the grand total from flickering through nonsense as someone types "1", "12",
   * "125" on the way to "12.5", and it stops the count-up animation restarting on every
   * keystroke.
   */
  const debouncedItems = useDebounced(state.items, DEBOUNCE_MS);

  const { total, results, errors } = useMemo(
    () => priceItems(debouncedItems, rates),
    [debouncedItems, rates],
  );

  useEffect(() => {
    if (state.notice) toast(state.notice);
  }, [state.notice]);

  const share = useCallback(async () => {
    setSharing(true);
    try {
      const response = await fetch('/api/calculator/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Items only. There is no total in this payload and the server would reject one.
        body: JSON.stringify({ items: state.items }),
      });

      if (!response.ok) {
        toast(
          response.status === 429
            ? 'Too many shared links just now. Try again in a little while.'
            : 'Could not create a link. Please try again.',
        );
        return;
      }

      const { path } = (await response.json()) as { path: string };
      const url = new URL(path, window.location.origin).toString();

      // §5.4: "Share (Web Share API → falls back to copy)".
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Jewellery price estimate', url });
          return;
        } catch {
          // The user dismissed the sheet, or the browser refused. Fall through to copy
          // rather than reporting a failure they caused deliberately.
        }
      }

      await navigator.clipboard.writeText(url);
      toast('Link copied to the clipboard.');
    } catch {
      toast('Could not create a link. Please try again.');
    } finally {
      setSharing(false);
    }
  }, [state.items]);

  const clearAll = useCallback(() => {
    clearItems();
    dispatch({ type: 'CLEAR_ALL', id: newId() });
  }, []);

  const atLimit = state.items.length >= MAX_ITEMS;

  return (
    <>
      {ratesError && (
        <p
          role="alert"
          className="rounded-field bg-down/10 px-4 py-3 text-small text-down"
        >
          Could not load today&rsquo;s rates. Totals are unavailable until the connection
          recovers.
        </p>
      )}

      <ul className="flex flex-col gap-4">
        {state.items.map((item, index) => (
          <li key={item.id}>
            <ItemCard
              item={item}
              index={index}
              result={results.get(item.id) ?? null}
              errors={errors.get(item.id) ?? {}}
              canRemove={state.items.length > 1}
              onChange={(patch) => dispatch({ type: 'UPDATE_ITEM', id: item.id, patch })}
              onRemove={() =>
                dispatch({ type: 'REMOVE_ITEM', id: item.id, replacementId: newId() })
              }
              onDuplicate={() =>
                dispatch({ type: 'DUPLICATE_ITEM', id: item.id, newId: newId() })
              }
            />
          </li>
        ))}
      </ul>

      {/* §5.4: "Prominent + Add another item button below the last card, full width,
          dashed outline." */}
      <button
        type="button"
        onClick={() => dispatch({ type: 'ADD_ITEM', id: newId() })}
        disabled={atLimit}
        className="flex h-control-lg w-full items-center justify-center gap-2 rounded-card border-2 border-dashed border-line text-body font-semibold text-taupe-deep transition-colors duration-fast ease-standard hover:border-taupe hover:bg-taupe-lt/20 disabled:opacity-40"
      >
        <Plus className="size-5" aria-hidden="true" />
        Add another item
      </button>

      {atLimit && (
        <p className="text-center text-small text-muted">
          You can price {MAX_ITEMS} items at once.
        </p>
      )}

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={clearAll}>
          Clear all
        </Button>
      </div>

      {rates ? (
        <>
          <TotalBar
            grandTotal={total?.grandTotal ?? 0n}
            itemCount={state.items.length}
            sharing={sharing}
            onExpand={() => setSheetOpen(true)}
            onShare={share}
          />
          <TotalSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            items={debouncedItems}
            total={total}
          />
        </>
      ) : (
        // §5.4: "Skeleton state matching final dimensions exactly — zero layout shift."
        <>
          {/* The same StickyBar, so the skeleton reserves exactly the space the real bar
              will — §5.4's "matching final dimensions exactly, zero layout shift". */}
          <StickyBar>
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-40" />
            </div>
            <Skeleton className="h-control w-28 rounded-pill" />
          </StickyBar>
        </>
      )}
    </>
  );
}

/**
 * Price every item that currently converts, and collect field errors for those that do not.
 *
 * A row with a typo in it does not stop the others from totalling. Someone pricing eight
 * pieces should not lose the running total because they are mid-way through typing the
 * ninth.
 */
function priceItems(
  items: CalculatorItem[],
  rates: RatesByPurity | null,
): {
  total: TotalResult | null;
  results: Map<string, LineResult>;
  errors: Map<string, FieldErrors>;
} {
  const errors = new Map<string, FieldErrors>();
  const results = new Map<string, LineResult>();

  if (!rates) return { total: null, results, errors };

  const priceable: { id: string; input: ReturnType<typeof toLineInput> }[] = [];

  for (const item of items) {
    const converted = toLineInput(item);
    if (converted.ok) {
      priceable.push({ id: item.id, input: converted });
    } else {
      errors.set(item.id, converted.errors);
    }
  }

  const inputs = priceable.flatMap((p) => (p.input.ok ? [p.input.input] : []));
  const total = calculateTotal(inputs, rates);

  priceable.forEach((p, index) => {
    const line = total.lines[index];
    if (line) results.set(p.id, line);
  });

  return { total, results, errors };
}

/** Hold a value still for `delay` ms after it stops changing. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
