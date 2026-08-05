/**
 * sessionStorage persistence for the calculator.
 * Created by Phase 5 (specs/05-calculator.md §5.3).
 *
 * §5.3: "Someone pricing eight items who accidentally refreshes should not lose the work."
 *
 * sessionStorage rather than localStorage, deliberately: the work is scoped to the visit.
 * A customer who priced a necklace last month and comes back for earrings should get a
 * clean sheet, not last month's list — and on a shared or shop-counter device, nothing
 * they typed should outlive the tab.
 *
 * Everything here is best-effort. Storage throws in Safari private mode and when the quota
 * is full, and losing a draft is annoying; a calculator that will not render because it
 * could not save one is worse.
 */
import { calculatorItemsSchema } from '@/lib/calculator/schema';
import type { CalculatorItem } from '@/lib/calculator/types';

export const STORAGE_KEY = 'tj:calculator:v1';

export function saveItems(items: CalculatorItem[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Private mode, quota, or no storage at all. The calculator keeps working.
  }
}

/**
 * Restore a draft, or null if there is nothing usable.
 *
 * The stored value is untrusted: the user can edit it, and a shape from an older deploy
 * can outlive the code that wrote it. It goes through the same Zod schema as the API, so a
 * hand-edited `"weightGrams": "abc"` is discarded rather than rendered into NaN.
 * `v1` in the key means a future shape change gets a new key instead of a migration.
 */
export function loadItems(): CalculatorItem[] | null {
  let raw: string | null = null;

  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    const parsed = calculatorItemsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      // Corrupt or hand-edited. Drop it so the next save starts clean.
      clearItems();
      return null;
    }
    return parsed.data;
  } catch {
    clearItems();
    return null;
  }
}

export function clearItems(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — see above.
  }
}
