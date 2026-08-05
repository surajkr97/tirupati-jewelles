/**
 * @vitest-environment jsdom
 *
 * Phase 5 TEST — calculator state, input conversion and the untrusted boundaries.
 * specs/05-calculator.md §5.3, §5.5 and the TEST section:
 *
 *   "'abc' in a numeric field → rejected at the Zod boundary."
 *   "Max 20 items; explain the limit rather than silently ignoring the add."
 *   "sessionStorage restore after refresh."
 *
 * jsdom for `sessionStorage`; the reducer itself is pure and needs no environment.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  calculatorReducer,
  initialState,
  MAX_ITEMS,
  type CalculatorState,
} from '@/lib/calculator/reducer';
import { MAX_LABEL_LENGTH, preloadedItemFromParams } from '@/lib/calculator/preload';
import { calculatorItemsSchema, shareRequestSchema } from '@/lib/calculator/schema';
import { clearItems, loadItems, saveItems, STORAGE_KEY } from '@/lib/calculator/storage';
import { emptyItem, toLineInput, type CalculatorItem } from '@/lib/calculator/types';
import { calculateTotal, type RatesByPurity } from '@/lib/pricing';

const RATES: RatesByPurity = {
  K22_916: 1_184_200n,
  K18_750: 969_300n,
  SILVER_999: 15_890n,
};

let counter = 0;
const nextId = () => `id-${(counter += 1)}`;

function stateWith(count: number): CalculatorState {
  let state = initialState(nextId());
  for (let i = 1; i < count; i += 1) {
    state = calculatorReducer(state, { type: 'ADD_ITEM', id: nextId() });
  }
  return state;
}

beforeEach(() => {
  counter = 0;
  clearItems();
});

// ──────────────────────────────────────────────────── the reducer

describe('initial state', () => {
  it('starts with exactly one item — never an empty screen (§5.4)', () => {
    const state = initialState('a');

    expect(state.items).toHaveLength(1);
    expect(state.notice).toBeNull();
  });

  it('pre-fills a making charge rather than implying free labour', () => {
    expect(initialState('a').items[0]?.makingPct).toBe('12');
  });
});

describe('ADD_ITEM', () => {
  it('appends an item', () => {
    const state = calculatorReducer(initialState('a'), { type: 'ADD_ITEM', id: 'b' });

    expect(state.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it(`stops at ${MAX_ITEMS} and says why, rather than ignoring the click`, () => {
    const full = stateWith(MAX_ITEMS);
    expect(full.items).toHaveLength(MAX_ITEMS);

    const overflowed = calculatorReducer(full, { type: 'ADD_ITEM', id: 'extra' });

    // §5.3: "explain the limit rather than silently ignoring the add." A button that does
    // nothing reads as broken.
    expect(overflowed.items).toHaveLength(MAX_ITEMS);
    expect(overflowed.notice).toMatch(new RegExp(String(MAX_ITEMS)));
  });

  it('clears a stale notice once an action succeeds', () => {
    const full = stateWith(MAX_ITEMS);
    const noticed = calculatorReducer(full, { type: 'ADD_ITEM', id: 'extra' });
    expect(noticed.notice).not.toBeNull();

    const removed = calculatorReducer(noticed, {
      type: 'REMOVE_ITEM',
      id: noticed.items[0]!.id,
      replacementId: 'fresh',
    });

    expect(removed.notice).toBeNull();
  });
});

describe('DUPLICATE_ITEM', () => {
  it('copies every field except the id', () => {
    let state = initialState('a');
    state = calculatorReducer(state, {
      type: 'UPDATE_ITEM',
      id: 'a',
      patch: { label: 'Bangle', weightGrams: '12.5', makingPct: '15' },
    });

    state = calculatorReducer(state, { type: 'DUPLICATE_ITEM', id: 'a', newId: 'b' });

    const [original, copy] = state.items;
    expect(copy).toEqual({ ...original, id: 'b' });
  });

  it('inserts the copy directly after its source, not at the end', () => {
    let state = stateWith(3);
    const [first, second, third] = state.items.map((i) => i.id);

    state = calculatorReducer(state, {
      type: 'DUPLICATE_ITEM',
      id: second!,
      newId: 'copy',
    });

    // §5.4: "pricing four similar bangles is the common case" — the copy belongs beside
    // the original, or the user has to hunt for it.
    expect(state.items.map((i) => i.id)).toEqual([first, second, 'copy', third]);
  });

  it('respects the item cap', () => {
    const full = stateWith(MAX_ITEMS);
    const result = calculatorReducer(full, {
      type: 'DUPLICATE_ITEM',
      id: full.items[0]!.id,
      newId: 'extra',
    });

    expect(result.items).toHaveLength(MAX_ITEMS);
    expect(result.notice).not.toBeNull();
  });

  it('ignores an unknown id rather than inserting a blank', () => {
    const state = stateWith(2);
    const result = calculatorReducer(state, {
      type: 'DUPLICATE_ITEM',
      id: 'nope',
      newId: 'x',
    });

    expect(result).toEqual(state);
  });
});

describe('REMOVE_ITEM', () => {
  it('removes the named item', () => {
    let state = stateWith(3);
    const target = state.items[1]!.id;

    state = calculatorReducer(state, {
      type: 'REMOVE_ITEM',
      id: target,
      replacementId: 'fresh',
    });

    expect(state.items).toHaveLength(2);
    expect(state.items.find((i) => i.id === target)).toBeUndefined();
  });

  it('leaves a fresh blank card when the last one is removed', () => {
    const state = calculatorReducer(initialState('a'), {
      type: 'REMOVE_ITEM',
      id: 'a',
      replacementId: 'fresh',
    });

    // Never the empty screen §5.4 forbids.
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.weightGrams).toBe('');
  });
});

describe('UPDATE_ITEM', () => {
  it('patches only the named item', () => {
    let state = stateWith(2);
    state = calculatorReducer(state, {
      type: 'UPDATE_ITEM',
      id: state.items[0]!.id,
      patch: { weightGrams: '5' },
    });

    expect(state.items[0]?.weightGrams).toBe('5');
    expect(state.items[1]?.weightGrams).toBe('');
  });

  it('derives metal from purity so the two can never disagree', () => {
    let state = initialState('a');

    state = calculatorReducer(state, {
      type: 'UPDATE_ITEM',
      id: 'a',
      patch: { purity: 'SILVER_999' },
    });
    expect(state.items[0]?.metal).toBe('SILVER');

    state = calculatorReducer(state, {
      type: 'UPDATE_ITEM',
      id: 'a',
      patch: { purity: 'K18_750' },
    });
    expect(state.items[0]?.metal).toBe('GOLD');
  });

  it('cannot be tricked into a GOLD/SILVER_999 pair by patching metal directly', () => {
    let state = initialState('a');
    state = calculatorReducer(state, {
      type: 'UPDATE_ITEM',
      id: 'a',
      patch: { purity: 'SILVER_999', metal: 'GOLD' },
    });

    // purity wins. That combination prices at zero and is the kind of inconsistency that
    // survives right up until a customer is quoted from it.
    expect(state.items[0]?.metal).toBe('SILVER');
  });
});

describe('SET_GLOBAL_GST and CLEAR_ALL', () => {
  it('applies one GST rate to every item', () => {
    let state = stateWith(3);
    state = calculatorReducer(state, { type: 'SET_GLOBAL_GST', gstPct: '5' });

    expect(state.items.every((i) => i.gstPct === '5')).toBe(true);
  });

  it('CLEAR_ALL returns to a single blank card', () => {
    let state = stateWith(5);
    state = calculatorReducer(state, { type: 'CLEAR_ALL', id: 'fresh' });

    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.id).toBe('fresh');
    expect(state.items[0]?.weightGrams).toBe('');
  });
});

describe('the reducer is pure', () => {
  it('never mutates the state it is given', () => {
    const state = stateWith(2);
    const snapshot = structuredClone(state);

    calculatorReducer(state, { type: 'ADD_ITEM', id: 'x' });
    calculatorReducer(state, {
      type: 'REMOVE_ITEM',
      id: state.items[0]!.id,
      replacementId: 'x',
    });
    calculatorReducer(state, {
      type: 'UPDATE_ITEM',
      id: state.items[0]!.id,
      patch: { weightGrams: '99' },
    });

    expect(state).toEqual(snapshot);
  });

  it('returns the same output for the same input', () => {
    const state = stateWith(2);
    const action = { type: 'ADD_ITEM', id: 'x' } as const;

    expect(calculatorReducer(state, action)).toEqual(calculatorReducer(state, action));
  });
});

// ──────────────────────────────────────────────────── conversion to engine input

describe('toLineInput', () => {
  const item = (over: Partial<CalculatorItem> = {}): CalculatorItem => ({
    ...emptyItem('a'),
    weightGrams: '10',
    ...over,
  });

  it('converts a filled row', () => {
    const result = toLineInput(item());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input).toEqual({
        metal: 'GOLD',
        purity: 'K22_916',
        weightMg: 10_000,
        makingPct: 12,
        stoneCharge: 0n,
        gstPct: 3,
      });
    }
  });

  it('treats an empty field as zero — a half-typed row is not an error', () => {
    const result = toLineInput(item({ weightGrams: '', stoneCharge: '' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.weightMg).toBe(0);
      expect(result.input.stoneCharge).toBe(0n);
    }
  });

  it.each([
    ['abc', 'weightGrams'],
    ['1.2.3', 'weightGrams'],
    ['-5', 'weightGrams'],
    ['10.0001', 'weightGrams'],
  ])('rejects %s in the weight field', (weightGrams, field) => {
    const result = toLineInput(item({ weightGrams }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveProperty(field);
  });

  it('rejects a percentage over 100', () => {
    const result = toLineInput(item({ makingPct: '101' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.makingPct).toBeDefined();
  });

  it('reports every bad field at once, not just the first', () => {
    const result = toLineInput(
      item({ weightGrams: 'abc', makingPct: 'xyz', stoneCharge: '??' }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // A form that reveals one error per submit takes three round trips to fix three
      // fields.
      expect(Object.keys(result.errors).sort()).toEqual([
        'makingPct',
        'stoneCharge',
        'weightGrams',
      ]);
    }
  });

  it('feeds the engine end to end', () => {
    const converted = toLineInput(item());
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;

    const total = calculateTotal([converted.input], RATES);

    // 10 g of 22K at 12% + 3% GST = ₹1,36,609.31, the first golden case.
    expect(total.grandTotal).toBe(13_660_931n);
  });
});

// ──────────────────────────────────────────────────── the Zod boundary

describe('the Zod boundary', () => {
  const valid = { ...emptyItem('a'), weightGrams: '10' };

  it('accepts a well-formed item set', () => {
    expect(calculatorItemsSchema.safeParse([valid]).success).toBe(true);
  });

  it.each(['abc', '1.2.3', '-5', '10.0001', 'Infinity', '1e3'])(
    'rejects %s as a weight',
    (weightGrams) => {
      // §5 TEST names this one explicitly.
      expect(calculatorItemsSchema.safeParse([{ ...valid, weightGrams }]).success).toBe(
        false,
      );
    },
  );

  it('rejects an unknown purity', () => {
    expect(calculatorItemsSchema.safeParse([{ ...valid, purity: 'K24' }]).success).toBe(
      false,
    );
  });

  it('rejects an empty list and one over the cap', () => {
    expect(calculatorItemsSchema.safeParse([]).success).toBe(false);
    expect(
      calculatorItemsSchema.safeParse(Array.from({ length: MAX_ITEMS + 1 }, () => valid))
        .success,
    ).toBe(false);
  });

  it('REJECTS a client-submitted total rather than ignoring it', () => {
    /**
     * §5: "A client-submitted total is display-only and is discarded on arrival."
     *
     * `.strict()` turns an attempt into a 400. Silently dropping the key would also be
     * safe, but a caller sending totals is either confused or probing, and both deserve
     * an answer.
     */
    const tampered = shareRequestSchema.safeParse({
      items: [valid],
      grandTotal: '1',
    });

    expect(tampered.success).toBe(false);
  });

  it('rejects a per-item total smuggled inside an item', () => {
    expect(
      shareRequestSchema.safeParse({ items: [{ ...valid, lineTotal: '1' }] }).success,
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────── §5.6 preloading

describe('preloading from a link (§5.6)', () => {
  const load = (query: string) =>
    preloadedItemFromParams(new URLSearchParams(query), 'preloaded');

  it('returns null for a plain visit', () => {
    expect(load('')).toBeNull();
  });

  it('fills metal, purity, weight, making and label', () => {
    const item = load('purity=K22_916&weight=8.475&making=12&label=Temple%20necklace');

    expect(item).toMatchObject({
      purity: 'K22_916',
      metal: 'GOLD',
      weightGrams: '8.475',
      makingPct: '12',
      label: 'Temple necklace',
    });
  });

  it('derives metal from purity rather than trusting the URL', () => {
    // A caller-supplied `metal` could contradict the purity, and GOLD/SILVER_999 prices
    // at zero.
    const item = load('purity=SILVER_999&metal=GOLD');

    expect(item?.metal).toBe('SILVER');
    expect(item?.purity).toBe('SILVER_999');
  });

  it.each([
    ['an unknown purity', 'purity=K24', 'purity', 'K22_916'],
    ['a non-numeric weight', 'weight=abc', 'weightGrams', ''],
    ['a weight with too many decimals', 'weight=1.2345', 'weightGrams', ''],
    ['a negative weight', 'weight=-5', 'weightGrams', ''],
    ['making over 100', 'making=150', 'makingPct', '12'],
    ['a non-numeric making', 'making=abc', 'makingPct', '12'],
  ])('drops %s and keeps the default', (_name, query, field, fallback) => {
    // A malformed link opens a usable calculator, not an error page.
    const item = load(query);

    expect(item).not.toBeNull();
    expect(item?.[field as 'purity']).toBe(fallback);
  });

  it('truncates an over-long label rather than rejecting the link', () => {
    const item = load(`label=${'x'.repeat(500)}`);

    expect(item?.label).toHaveLength(MAX_LABEL_LENGTH);
  });

  it('carries a stone charge, so a product link and its page agree', () => {
    /**
     * Added in Phase 6. Without it the product page and the calculator it links to
     * disagreed by exactly the stone charge — ₹7,47,252 against ₹68,030 on a seeded
     * necklace. A "Calculate with current rates" button that produces a different figure
     * from the price above it is worse than no button.
     */
    const item = load('purity=K22_916&weight=48.5&making=15&stone=65000.00');

    expect(item?.stoneCharge).toBe('65000.00');

    const converted = toLineInput(item!);
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.input.stoneCharge).toBe(6_500_000n);
  });

  it.each([
    ['a non-numeric stone charge', 'stone=abc'],
    ['too many decimals', 'stone=1.234'],
    ['a negative stone charge', 'stone=-5'],
  ])('drops %s', (_name, query) => {
    expect(load(query)?.stoneCharge).toBe('');
  });

  it('a preloaded item prices correctly end to end', () => {
    const item = load('purity=K22_916&weight=10&making=12');
    const converted = toLineInput(item!);

    expect(converted.ok).toBe(true);
    if (!converted.ok) return;

    expect(calculateTotal([converted.input], RATES).grandTotal).toBe(13_660_931n);
  });
});

// ──────────────────────────────────────────────────── sessionStorage

describe('sessionStorage round trip', () => {
  const items = [{ ...emptyItem('a'), weightGrams: '12.5', label: 'Bangle' }];

  it('restores what was saved — §5.3, an accidental refresh loses nothing', () => {
    saveItems(items);

    expect(loadItems()).toEqual(items);
  });

  it('returns null when nothing was saved', () => {
    expect(loadItems()).toBeNull();
  });

  it('discards a hand-edited value rather than rendering NaN', () => {
    // The user can open devtools and type anything here. It goes through the same schema
    // as the public API.
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ ...items[0], weightGrams: 'abc' }]),
    );

    expect(loadItems()).toBeNull();
    // And the poisoned value is cleared, so the next save starts clean.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('discards malformed JSON', () => {
    sessionStorage.setItem(STORAGE_KEY, '{not json');

    expect(loadItems()).toBeNull();
  });

  it('discards a shape from an older deploy', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'a', weight: 10 }]));

    expect(loadItems()).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        // Safari private mode and a full quota both behave like this.
        throw new Error('SecurityError');
      },
    });

    try {
      expect(() => saveItems(items)).not.toThrow();
      expect(loadItems()).toBeNull();
      expect(() => clearItems()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});
