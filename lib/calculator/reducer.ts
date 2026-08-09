/**
 * Calculator state machine.
 * Created by Phase 5 (specs/05-calculator.md §5.3).
 *
 * §5.3: "`useReducer`, not a pile of `useState`." Six actions mutate one item list, and a
 * pile of setters makes "add an item, then clear all" a sequencing question rather than a
 * transition. This way the whole state machine is a pure function and is unit-tested
 * without rendering anything.
 *
 * IDs arrive in the action rather than being generated here. A reducer that calls
 * `crypto.randomUUID()` is not pure, cannot be replayed, and cannot be tested without
 * stubbing a global.
 */
import {
  emptyItem,
  metalForPurity,
  type CalculatorItem,
  type ItemDefaults,
} from '@/lib/calculator/types';
import type { PurityKey } from '@/lib/pricing';

/** §5.3: "Max 20 items; explain the limit rather than silently ignoring the add." */
export const MAX_ITEMS = 20;

export interface CalculatorState {
  items: CalculatorItem[];
  /**
   * The shop's §7.9 prefills, carried in state rather than read at the call site.
   *
   * `ADD_ITEM`, `CLEAR_ALL` and the last `REMOVE_ITEM` all mint a blank line, and a reducer
   * that reached outside itself for those figures would stop being a pure function of
   * (state, action) — the property §5.3 chose `useReducer` for. So the defaults enter once,
   * with the initial state, and every later transition reads them from `state`. DEBT-024.
   */
  defaults: ItemDefaults;
  /**
   * Set when an action could not be applied. The UI surfaces it and the next successful
   * action clears it — a limit the user cannot see is indistinguishable from a bug.
   */
  notice: string | null;
}

export type CalculatorAction =
  | { type: 'ADD_ITEM'; id: string }
  /**
   * `id` is the item to remove; `replacementId` is only used when it was the last one.
   *
   * Two fields rather than one, because a single `id` has to mean both "which item" and
   * "the id of the blank card that replaces it", and those are different values. Sharing
   * them made the caller pass a fresh id and remove nothing at all.
   */
  | { type: 'REMOVE_ITEM'; id: string; replacementId: string }
  | { type: 'UPDATE_ITEM'; id: string; patch: Partial<Omit<CalculatorItem, 'id'>> }
  | { type: 'DUPLICATE_ITEM'; id: string; newId: string }
  | { type: 'CLEAR_ALL'; id: string }
  | { type: 'SET_GLOBAL_GST'; gstPct: string }
  | { type: 'RESTORE'; items: CalculatorItem[] }
  | { type: 'DISMISS_NOTICE' };

/** §5.4: "One item card pre-added. Never an empty screen with a lone add button." */
export function initialState(id: string, defaults: ItemDefaults): CalculatorState {
  return { items: [emptyItem(id, defaults)], notice: null, defaults };
}

export function calculatorReducer(
  state: CalculatorState,
  action: CalculatorAction,
): CalculatorState {
  switch (action.type) {
    case 'ADD_ITEM': {
      if (state.items.length >= MAX_ITEMS) return atLimit(state);
      return {
        ...state,
        items: [...state.items, emptyItem(action.id, state.defaults)],
        notice: null,
      };
    }

    case 'DUPLICATE_ITEM': {
      if (state.items.length >= MAX_ITEMS) return atLimit(state);

      const index = state.items.findIndex((item) => item.id === action.id);
      if (index === -1) return state;

      const source = state.items[index];
      if (!source) return state;

      // Inserted directly after its source, not appended. §5.4: "pricing four similar
      // bangles is the common case" — the copy belongs next to the original.
      const copy: CalculatorItem = { ...source, id: action.newId };
      const items = [...state.items];
      items.splice(index + 1, 0, copy);

      return { ...state, items, notice: null };
    }

    case 'REMOVE_ITEM': {
      const remaining = state.items.filter((item) => item.id !== action.id);

      // Removing the last card would leave the empty screen §5.4 forbids, so it is
      // replaced with a fresh blank one. "Remove" and "clear" become the same gesture at
      // the boundary, which is what a user expects.
      if (remaining.length === 0) {
        return {
          ...state,
          items: [emptyItem(action.replacementId, state.defaults)],
          notice: null,
        };
      }

      return { ...state, items: remaining, notice: null };
    }

    case 'UPDATE_ITEM': {
      return {
        ...state,
        items: state.items.map((item) => {
          if (item.id !== action.id) return item;

          const next = { ...item, ...action.patch };

          // Metal is a function of purity, never set independently. Two fields that can
          // disagree will eventually disagree, and a GOLD/SILVER_999 line prices at zero.
          if (action.patch.purity) next.metal = metalForPurity(action.patch.purity);

          return next;
        }),
        notice: null,
      };
    }

    case 'SET_GLOBAL_GST': {
      // One GST rate for the whole calculation (§5.3). The engine takes it per line
      // because Phase 8 bills may mix rates; the calculator does not expose that.
      return {
        ...state,
        items: state.items.map((item) => ({ ...item, gstPct: action.gstPct })),
        notice: null,
      };
    }

    case 'CLEAR_ALL':
      return initialState(action.id, state.defaults);

    case 'RESTORE': {
      // Restoring nothing must not produce an empty screen either.
      if (action.items.length === 0) return state;
      // The restored draft keeps its own per-item figures; `defaults` is not part of it,
      // so a settings change since the draft was saved applies to the NEXT blank line
      // rather than silently repricing what the customer is already looking at.
      return { ...state, items: action.items.slice(0, MAX_ITEMS), notice: null };
    }

    case 'DISMISS_NOTICE':
      return { ...state, notice: null };

    default:
      return state;
  }
}

function atLimit(state: CalculatorState): CalculatorState {
  return {
    ...state,
    notice: `You can price ${MAX_ITEMS} items at once. Remove one to add another.`,
  };
}

/** Purities a caller may preload from a product page (§5.6). */
export function isPurityKey(value: string): value is PurityKey {
  return value === 'K22_916' || value === 'K18_750' || value === 'SILVER_999';
}
