/**
 * Preloading the calculator from a link.
 * Created by Phase 5 (specs/05-calculator.md §5.6).
 *
 * §5.6: "'Calculate with current rates' on a product page preloads the calculator with
 * that product's metal, purity, weight, and making %."
 *
 * A query string rather than shared client state or a new endpoint, so Phase 6's product
 * page needs nothing but an `<a href>`:
 *
 *   /calculator?purity=K22_916&weight=8.475&making=12&label=Temple%20necklace
 *
 * Client-safe on purpose. Reading these on the server would make `/calculator` render
 * per-request, and MASTER-SPEC §6 specifies a static shell with a CSR island.
 *
 * Every value is validated and anything unrecognised is DROPPED rather than rejected. A
 * malformed link should open a usable calculator, not an error page — and these values
 * only ever reach form fields, with `toLineInput` doing the real validation before any
 * arithmetic happens.
 */
import { isPurityKey } from '@/lib/calculator/reducer';
import {
  emptyItem,
  metalForPurity,
  type CalculatorItem,
  type ItemDefaults,
} from '@/lib/calculator/types';

export const MAX_LABEL_LENGTH = 80;

/** Up to 7 whole grams' digits and the 3 decimals MASTER-SPEC §4 allows. */
const WEIGHT_PATTERN = /^\d{1,7}(\.\d{1,3})?$/;
/** 0–100 with the 2 decimals `Decimal(5,2)` stores. */
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;
/** Rupees with at most 2 decimals. */
const RUPEES_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

export function preloadedItemFromParams(
  params: URLSearchParams,
  id: string,
  defaults: ItemDefaults,
): CalculatorItem | null {
  const purity = params.get('purity');
  const weight = params.get('weight');
  const making = params.get('making');
  const label = params.get('label');
  const stone = params.get('stone');

  // No recognised parameters at all — a plain visit, not a preload.
  if (
    purity === null &&
    weight === null &&
    making === null &&
    label === null &&
    stone === null
  ) {
    return null;
  }

  const item = emptyItem(id, defaults);

  if (purity && isPurityKey(purity)) {
    item.purity = purity;
    // Derived, never taken from the URL. A caller-supplied `metal` could contradict the
    // purity, and GOLD/SILVER_999 prices at zero.
    item.metal = metalForPurity(purity);
  }

  if (weight && WEIGHT_PATTERN.test(weight)) {
    item.weightGrams = weight;
  }

  if (making && PERCENT_PATTERN.test(making) && Number(making) <= 100) {
    item.makingPct = making;
  }

  /**
   * `stone` is beyond §5.6's list of "metal, purity, weight, and making %", and it is here
   * because leaving it out was measurably wrong.
   *
   * A Phase 6 product page carries a stone charge, and without this the product page and
   * the calculator it links to disagreed by exactly that amount — ₹7,47,252 against
   * ₹68,030 on a seeded necklace. A "Calculate with current rates" button that produces a
   * different figure from the price above it is worse than no button.
   */
  if (stone && RUPEES_PATTERN.test(stone)) {
    item.stoneCharge = stone;
  }

  if (label) {
    // Truncated, not rejected. React escapes it on render, so the length cap is about
    // layout rather than safety.
    item.label = label.slice(0, MAX_LABEL_LENGTH);
  }

  return item;
}
