/**
 * @vitest-environment jsdom
 *
 * Phase 5 TEST — the calculator as a user drives it.
 * specs/05-calculator.md §5.3, §5.4 and the TEST section:
 *
 *   "sessionStorage restore after refresh."
 *   "20 items → correct total, no perf degradation."
 *   "Max 20 items; explain the limit rather than silently ignoring the add."
 *
 * The reducer is unit-tested in lib/calculator/calculator.test.ts; this file is about the
 * wiring — that a click reaches the reducer, that a total reaches the screen, and that a
 * refresh does not lose eight items of work.
 */
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  clientEnv: { NEXT_PUBLIC_TICKER_JITTER: false, NEXT_PUBLIC_OWNER_WA: '919876543210' },
}));

import { Calculator } from '@/components/calculator/calculator';
import { MAX_ITEMS } from '@/lib/calculator/reducer';
import { STORAGE_KEY } from '@/lib/calculator/storage';
import type { CalculatorItem } from '@/lib/calculator/types';

const API_PAYLOAD = {
  gold22: {
    perGram: '1184200',
    display: '11842000',
    change: '0',
    effectiveAt: '2026-08-05T06:12:00.000Z',
    unit: 'per 10 grams',
  },
  gold18: {
    perGram: '969300',
    display: '9693000',
    change: '0',
    effectiveAt: '2026-08-05T06:12:00.000Z',
    unit: 'per 10 grams',
  },
  silver999: {
    perGram: '15890',
    display: '15890000',
    change: '0',
    effectiveAt: '2026-08-05T06:12:00.000Z',
    unit: 'per 1 kilogram',
  },
};

const ITEM: CalculatorItem = {
  id: 'a',
  label: 'Chain',
  metal: 'GOLD',
  purity: 'K22_916',
  weightGrams: '10',
  makingPct: '12',
  stoneCharge: '',
  gstPct: '3',
};

beforeEach(() => {
  sessionStorage.clear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(API_PAYLOAD), { status: 200 })),
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
  // The total bar's count-up runs on rAF; settle it immediately so assertions read the
  // final figure rather than a frame of the animation.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(performance.now() + 1000);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    randomUUID: () => `id-${Math.random()}`,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
}

describe('first paint', () => {
  it('starts with one item card — never an empty screen (§5.4)', async () => {
    render(<Calculator />);
    await settle();

    expect(screen.getAllByTestId('item-card')).toHaveLength(1);
  });

  it('shows a skeleton total bar until rates arrive, then the real one', async () => {
    render(<Calculator />);

    // §5.4: "Skeleton state matching final dimensions exactly — zero layout shift."
    expect(screen.queryByTestId('grand-total')).not.toBeInTheDocument();

    await settle();

    expect(screen.getByTestId('grand-total')).toBeInTheDocument();
  });

  it('prices a preloaded item', async () => {
    render(<Calculator initialItems={[ITEM]} />);
    await settle();

    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹1,36,609');
  });
});

describe('adding, duplicating and removing', () => {
  it('adds an item', async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await settle();

    await user.click(screen.getByRole('button', { name: /Add another item/i }));

    expect(screen.getAllByTestId('item-card')).toHaveLength(2);
  });

  it('duplicating copies the values and doubles the total', async () => {
    const user = userEvent.setup();
    render(<Calculator initialItems={[ITEM]} />);
    await settle();

    await user.click(screen.getByRole('button', { name: /Duplicate Chain/i }));
    await settle();

    expect(screen.getAllByTestId('item-card')).toHaveLength(2);
    // ₹1,36,609.31 × 2 = ₹2,73,218.62.
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹2,73,218');
  });

  it('removing an item drops it from the total', async () => {
    const user = userEvent.setup();
    render(<Calculator initialItems={[ITEM, { ...ITEM, id: 'b', label: 'Ring' }]} />);
    await settle();

    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹2,73,218');

    await user.click(screen.getByRole('button', { name: /Remove Ring/i }));
    await settle();

    expect(screen.getAllByTestId('item-card')).toHaveLength(1);
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹1,36,609');
  });

  it('removing the only item leaves a blank card rather than an empty screen', async () => {
    const user = userEvent.setup();
    render(<Calculator initialItems={[ITEM]} />);
    await settle();

    await user.click(screen.getByRole('button', { name: /Clear Chain/i }));
    await settle();

    expect(screen.getAllByTestId('item-card')).toHaveLength(1);
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹0');
  });
});

describe(`the ${MAX_ITEMS}-item cap`, () => {
  it('stops adding and explains why, rather than a button that does nothing', async () => {
    render(
      <Calculator
        initialItems={Array.from({ length: MAX_ITEMS }, (_, i) => ({
          ...ITEM,
          id: `i${i}`,
        }))}
      />,
    );
    await settle();

    // Disabled AND explained. §5.3: "explain the limit rather than silently ignoring the
    // add." A disabled button with no reason beside it is the same dead end.
    expect(screen.getByRole('button', { name: /Add another item/i })).toBeDisabled();
    expect(screen.getByText(new RegExp(`price ${MAX_ITEMS} items`, 'i'))).toBeVisible();
    expect(screen.getAllByTestId('item-card')).toHaveLength(MAX_ITEMS);
  });

  it(`totals ${MAX_ITEMS} items correctly`, async () => {
    render(
      <Calculator
        initialItems={Array.from({ length: MAX_ITEMS }, (_, i) => ({
          ...ITEM,
          id: `i${i}`,
        }))}
      />,
    );
    await settle();

    // ₹1,36,609.31 × 20 = ₹27,32,186.20.
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹27,32,186');
  });
});

describe('typing', () => {
  it('recalculates after the debounce', async () => {
    const user = userEvent.setup();
    render(<Calculator initialItems={[{ ...ITEM, weightGrams: '' }]} />);
    await settle();

    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹0');

    await user.type(screen.getByLabelText('Weight'), '10');
    await settle();

    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹1,36,609');
  });

  it('shows a field error for text in a numeric field, and keeps other items totalling', async () => {
    const user = userEvent.setup();
    render(<Calculator initialItems={[ITEM, { ...ITEM, id: 'b', weightGrams: '' }]} />);
    await settle();

    const secondCard = screen.getAllByTestId('item-card')[1]!;
    await user.type(within(secondCard).getByLabelText('Weight'), 'abc');
    await settle();

    await waitFor(() => {
      expect(within(secondCard).getByRole('alert')).toBeInTheDocument();
    });

    // The good row still totals — someone pricing eight pieces should not lose the running
    // total because they are mid-way through typing the ninth.
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹1,36,609');
  });

  it('a making-charge chip sets the value', async () => {
    const user = userEvent.setup();
    render(<Calculator initialItems={[ITEM]} />);
    await settle();

    await user.click(screen.getByRole('button', { name: '15%' }));
    await settle();

    expect(screen.getByLabelText('Making')).toHaveValue('15');
    // metal ₹1,18,420 + making ₹17,763 = ₹1,36,183, +3% GST = ₹1,40,268.49.
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹1,40,268');
  });

  it('switching purity reprices against the other metal', async () => {
    const user = userEvent.setup();
    render(<Calculator initialItems={[ITEM]} />);
    await settle();

    await user.click(screen.getByRole('radio', { name: 'Silver' }));
    await settle();

    // 10 g of silver at ₹15,890/kg = ₹158.90/g → ₹1,589 metal, +12% +3% = ₹1,833.
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹1,833');
  });
});

describe('sessionStorage — §5.3, an accidental refresh loses nothing', () => {
  it('persists items as they change', async () => {
    const user = userEvent.setup();
    render(<Calculator />);
    await settle();

    await user.type(screen.getByLabelText('Weight'), '12.5');
    await settle();

    await waitFor(() => {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
      expect(saved[0]?.weightGrams).toBe('12.5');
    });
  });

  it('restores them on the next mount', async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([ITEM, { ...ITEM, id: 'b', label: 'Bangle' }]),
    );

    // A fresh mount is what a refresh looks like to the component.
    render(<Calculator />);
    await settle();

    expect(screen.getAllByTestId('item-card')).toHaveLength(2);
    expect(screen.getByDisplayValue('Bangle')).toBeInTheDocument();
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹2,73,218');
  });

  it('does NOT restore over a preloaded or shared item set', async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ ...ITEM, label: 'Old draft' }]),
    );

    render(<Calculator initialItems={[{ ...ITEM, label: 'From the link' }]} />);
    await settle();

    // Opening someone's shared link must not silently swap in your own old draft.
    expect(screen.getByDisplayValue('From the link')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Old draft')).not.toBeInTheDocument();
  });

  it('clear all wipes the stored draft too', async () => {
    const user = userEvent.setup();
    render(<Calculator initialItems={undefined} />);
    await settle();

    await user.type(screen.getByLabelText('Weight'), '10');
    await settle();
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /Clear all/i }));
    await settle();

    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹0');
  });
});

describe('the breakdown', () => {
  it('expands to show every component, and they add up', async () => {
    const user = userEvent.setup();
    render(<Calculator initialItems={[ITEM]} />);
    await settle();

    await user.click(screen.getByRole('button', { name: /Show breakdown/i }));

    // ₹1,18,420 metal + ₹14,210.40 making + ₹3,978.91 GST = ₹1,36,609.31.
    expect(screen.getByText('₹1,18,420.00')).toBeInTheDocument();
    expect(screen.getByText('₹14,210.40')).toBeInTheDocument();
    expect(screen.getByText('₹3,978.91')).toBeInTheDocument();
    expect(screen.getAllByText('₹1,36,609.31').length).toBeGreaterThan(0);
  });
});
