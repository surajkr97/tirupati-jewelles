/**
 * @vitest-environment jsdom
 *
 * Phase 5 TEST — **the critical case**, and the settlement of DEBT-013.
 * specs/05-calculator.md TEST:
 *
 *   "**Critical:** admin sets rate → open the calculator → assert the calculator uses the
 *    true rate, not a jittered one. Run this test with jitter enabled."
 *   "Verify the calculator uses the true rate while the ticker is jittering."
 *
 * Phase 4 could not run this — the calculator did not exist — and signed off with it owed
 * as DEBT-013. This is that debt paid.
 *
 * ── What makes this a real test rather than a restatement ──
 * The ticker and the calculator are mounted **in the same document at the same time**,
 * with `NEXT_PUBLIC_TICKER_JITTER` on and reduced-motion off, so the jitter loop is
 * genuinely running and visibly changing the ticker's number. The calculator's total is
 * then asserted against a figure computed from the stored rate. If the two components
 * shared any state — a module-level variable, a context, a cache — this would fail.
 */
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { clientEnv } = vi.hoisted(() => ({
  clientEnv: { NEXT_PUBLIC_TICKER_JITTER: true, NEXT_PUBLIC_OWNER_WA: '919876543210' },
}));

vi.mock('@/lib/env', () => ({ clientEnv }));

// SWR is the ticker's transport; this file is about rate provenance, not fetching.
vi.mock('swr', () => ({
  default: (_key: string, _fetcher: unknown, options?: { fallbackData?: unknown }) => ({
    data: options?.fallbackData,
    mutate: () => Promise.resolve(undefined),
    isValidating: false,
  }),
}));

// The card's two action links are navigation, not the subject of this file.
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

import { Calculator } from '@/components/calculator/calculator';
import { LiveRateCard } from '@/components/rates/live-rate-card';
import type { SerialisedRates } from '@/lib/rates.keys';
import { calculateTotal, type RatesByPurity } from '@/lib/pricing';
import { SPEC_ITEM_DEFAULTS, type CalculatorItem } from '@/lib/calculator/types';

/** The rate the admin set. Paise per gram — ₹1,18,420 per 10 g. */
const TRUE_PER_GRAM = 1_184_200n;

const RATES: RatesByPurity = {
  K22_916: TRUE_PER_GRAM,
  K18_750: 969_300n,
  SILVER_999: 15_890n,
};

const API_PAYLOAD: SerialisedRates = {
  gold22: {
    perGram: TRUE_PER_GRAM.toString(),
    display: '11842000',
    change: '32000',
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

/** 10 g of 22K at 12% making + 3% GST — golden case #1. */
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

const EXPECTED = '₹1,36,609';

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  clientEnv.NEXT_PUBLIC_TICKER_JITTER = true;
  stubMatchMedia(false);

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(API_PAYLOAD), { status: 200 })),
  );
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    // The total bar's count-up runs on rAF. Firing immediately makes it land on the final
    // value synchronously, so assertions read the settled number rather than a frame of
    // the animation.
    cb(performance.now() + 1000);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Let the rates fetch resolve and the 150ms debounce elapse. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
}

describe('the calculator uses the TRUE rate while the ticker jitters', () => {
  it('is the critical case: both mounted, jitter on, totals unmoved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(
      <>
        <LiveRateCard initialRates={API_PAYLOAD} />
        <Calculator defaults={SPEC_ITEM_DEFAULTS} initialItems={[ITEM]} />
      </>,
    );

    await settle();

    const tickerBefore = screen.getByTestId('ticker-value').textContent;
    const totalBar = screen.getByTestId('total-bar');
    expect(within(totalBar).getByTestId('grand-total')).toHaveTextContent(EXPECTED);

    // Run the jitter loop for 30 seconds of wall-clock ticks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    const tickerAfter = screen.getByTestId('ticker-value').textContent;

    // The ticker really did move — otherwise the assertion below proves nothing.
    expect(tickerAfter).not.toBe(tickerBefore);

    // And the calculator did not. MASTER-SPEC §8: "the calculator and every bill always
    // use the true admin rate, never the jittered display value."
    expect(within(totalBar).getByTestId('grand-total')).toHaveTextContent(EXPECTED);
  });

  it('the total equals the engine applied to the stored rate, to the paise', async () => {
    render(<Calculator defaults={SPEC_ITEM_DEFAULTS} initialItems={[ITEM]} />);
    await settle();

    // Computed here from `RATES`, not read from the component — the point is that the
    // screen agrees with the stored rate, so the expectation must come from the rate.
    const expected = calculateTotal(
      [
        {
          metal: 'GOLD',
          purity: 'K22_916',
          weightMg: 10_000,
          makingPct: 12,
          stoneCharge: 0n,
          gstPct: 3,
        },
      ],
      RATES,
    );

    expect(expected.grandTotal).toBe(13_660_931n);
    expect(screen.getByTestId('grand-total')).toHaveTextContent('₹1,36,609');
  });

  it('reads the rate from /api/rates and nowhere else', async () => {
    render(<Calculator defaults={SPEC_ITEM_DEFAULTS} initialItems={[ITEM]} />);
    await settle();

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;

    // One request, to the endpoint that serves the stored rate. Not the ticker's props,
    // not a shared module, not localStorage.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('/api/rates');
  });

  it('shows no total at all rather than a wrong one when rates cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );

    render(<Calculator defaults={SPEC_ITEM_DEFAULTS} initialItems={[ITEM]} />);
    await settle();

    // A calculator that invents a rate is worse than one that admits it is offline.
    expect(screen.queryByTestId('grand-total')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Could not load/i);
  });

  it('ignores a malformed rates payload rather than pricing from it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ gold22: { perGram: 'not-a-number' } }), {
            status: 200,
          }),
      ),
    );

    render(<Calculator defaults={SPEC_ITEM_DEFAULTS} initialItems={[ITEM]} />);
    await settle();

    expect(screen.queryByTestId('grand-total')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('the jitter is unreachable from the calculator by construction', () => {
  it('no calculator module imports the jitter', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');

    const files = [
      ...readdirSync('components/calculator').map((f) =>
        join('components/calculator', f),
      ),
      ...readdirSync('lib/calculator').map((f) => join('lib/calculator', f)),
      'lib/pricing.ts',
    ].filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

    for (const file of files) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;

      const imports = readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => /^\s*import\b/.test(l))
        .join('\n');

      // §4: "If you find yourself passing it as a prop, you have made a mistake."
      // Asserted across the whole feature rather than trusted, because the mistake is a
      // one-line import away and prices a customer's bangle wrong when it happens.
      // `live-rate-card` replaced `rate-ticker` in Stage 4B; the pattern follows it, or
      // this stops guarding the thing it was written for.
      expect(imports, `${file} must not import the ticker jitter`).not.toMatch(
        /ticker-jitter|rate-ticker|live-rate-card/,
      );
    }
  });
});
