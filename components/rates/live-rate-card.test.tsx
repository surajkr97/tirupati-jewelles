/**
 * @vitest-environment jsdom
 *
 * Phase 4 TEST — the rate card's timer lifecycle and the off-switch.
 * Moved from `rate-ticker.test.tsx` by Stage 4B, which replaced `LiveRateCard` with
 * `LiveRateCard`. The criteria below are Phase 4's and are unchanged; only the component
 * under test moved.
 * specs/04-rates-ticker.md §4.3 and the TEST section:
 *
 *   "prefers-reduced-motion → no jitter at all, static true rate."
 *   "Pause the interval when the tab is hidden (visibilitychange)."
 *   "Clean up the interval on unmount. React strict mode will double-invoke the effect —
 *    verify no leaked timers."
 *   "Memory: mount/unmount the ticker 100× → no growing timer count."
 *
 * Written from those criteria, not from the component. The jitter *maths* is proven
 * separately over 10,000 ticks in lib/ticker-jitter.test.ts; this file is only about
 * whether the timer is created, paused, and destroyed when it should be — which is a thing
 * a browser cannot count and a unit test can.
 *
 * `swr` is stubbed to hand back its own `fallbackData`. It is the transport, not the
 * subject: leaving it real would put a network call and a second set of timers inside a
 * fake-timer test and prove nothing extra.
 */
import '@testing-library/jest-dom/vitest';

import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Flipped per test to stand in for NEXT_PUBLIC_TICKER_JITTER.
 *
 * `vi.hoisted` because `vi.mock` is lifted above the imports, so a plain `const` here
 * would not exist yet when the factory runs.
 */
const { clientEnv } = vi.hoisted(() => ({
  clientEnv: { NEXT_PUBLIC_TICKER_JITTER: true, NEXT_PUBLIC_OWNER_WA: '919876543210' },
}));

vi.mock('@/lib/env', () => ({ clientEnv }));

/**
 * `next/link` is stubbed for the same reason `swr` is: it is transport, not the subject.
 *
 * `LiveRateCard` renders two Links for its actions, and Next schedules prefetch work on a
 * timer for each. `vi.getTimerCount()` counts every fake timer, not just intervals, so with
 * real Links the "no interval when the flag is off" assertion measured 2 and the
 * "paused while hidden" assertion never reached 0 — both reporting a jitter timer that did
 * not exist. A plain anchor keeps the timer count meaning what the tests say it means.
 */
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('swr', () => ({
  // `mutate` and `isValidating` are read by the refresh control; the stub has to supply
  // them or the component throws before any timer assertion can run.
  default: (_key: string, _fetcher: unknown, options?: { fallbackData?: unknown }) => ({
    mutate: () => Promise.resolve(undefined),
    isValidating: false,
    data: options?.fallbackData,
  }),
}));

import { LiveRateCard, type SerialisedRates } from '@/components/rates/live-rate-card';
import { JITTER_BAND_PAISE, TICK_INTERVAL_MS } from '@/lib/ticker-jitter';

const GOLD_22_PER_10G = 11_842_000n; // ₹1,18,420

const RATES: SerialisedRates = {
  gold22: {
    perGram: '1184200',
    display: GOLD_22_PER_10G.toString(),
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
    change: '-11000',
    effectiveAt: '2026-08-05T06:12:00.000Z',
    unit: 'per 1 kilogram',
  },
};

/** jsdom has no matchMedia. Install one whose answer this test controls. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string): MediaQueryList =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Run the jitter loop for `seconds` and collect every value the card displayed. */
async function runFor(seconds: number): Promise<string[]> {
  const seen = [screen.getByTestId('ticker-value').textContent ?? ''];

  for (let i = 0; i < seconds; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    seen.push(screen.getByTestId('ticker-value').textContent ?? '');
  }

  return seen;
}

beforeEach(() => {
  clientEnv.NEXT_PUBLIC_TICKER_JITTER = true;
  stubReducedMotion(false);
  setTabHidden(false);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * The off-switch moved from an environment variable to a prop in Stage 6.
 *
 * The card used to read `NEXT_PUBLIC_TICKER_JITTER` itself, which is why the owner's
 * dashboard toggle — stored, audited, revalidated — changed nothing on the storefront. The
 * flag is now resolved on the server by `getTickerJitter` (setting first, env as fallback)
 * and arrives here as `jitter`. These tests therefore drive the prop; `lib/settings.test.ts`
 * covers the resolution behind it.
 */
describe('the off-switch — the `jitter` prop', () => {
  it('holds the value constant for 10s when it is off', async () => {
    render(<LiveRateCard initialRates={RATES} jitter={false} />);

    const seen = await runFor(10);

    // MASTER-SPEC §8: "Ship with a working off-switch." It is the mitigation of last
    // resort for the consumer-protection exposure, so it must be genuinely inert.
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe('₹1,18,420');
  });

  it('creates no interval at all when it is off', async () => {
    render(<LiveRateCard initialRates={RATES} jitter={false} />);

    // Not merely "the number did not change" — nothing is scheduled to change it.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('defaults to off, so a caller that forgets the prop gets the still card', async () => {
    // The safe direction for a number MASTER-SPEC §8 governs: silence, not invented movement.
    render(<LiveRateCard initialRates={RATES} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the positive control: with it on, the value does move', async () => {
    render(<LiveRateCard initialRates={RATES} jitter />);

    const seen = await runFor(10);

    // Without this, both assertions above would also pass on a ticker that never mounted.
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});

describe('prefers-reduced-motion', () => {
  it('produces no jitter even with the prop on', async () => {
    stubReducedMotion(true);
    render(<LiveRateCard initialRates={RATES} jitter />);

    const seen = await runFor(10);

    // §4.3 requires no jitter at all here. The global CSS override in globals.css stops
    // animations but cannot stop a setInterval, so this has to be a JS decision — and a
    // per-second number change is precisely what a vestibular-sensitivity user has asked
    // the OS to prevent.
    expect(new Set(seen).size).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('all three faces move, on one switch', () => {
  /**
   * The owner's Stage 6 request. Before it, only the 22K anchor walked and the 18K and
   * silver rows rendered `BigInt(face.display)` — the true rate, sitting still — so the card
   * showed one live figure beside two frozen ones.
   *
   * Read off the DOM rather than off state: the frozen rows were frozen because the render
   * ignored the walk, which is a defect no assertion about internal state would have caught.
   */
  function secondaryTexts(): string[] {
    return within(screen.getByTestId('rate-ticker'))
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '');
  }

  it('moves 18K and silver, not just the 22K anchor', async () => {
    render(<LiveRateCard initialRates={RATES} jitter />);

    const before = secondaryTexts();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICK_INTERVAL_MS * 4);
    });
    const after = secondaryTexts();

    expect(before.length, 'both secondary rows must be on screen').toBe(2);
    for (let i = 0; i < before.length; i += 1) {
      expect(after[i], `secondary row ${i} never moved`).not.toBe(before[i]);
    }
  });

  it('holds every face still when the switch is off', async () => {
    render(<LiveRateCard initialRates={RATES} jitter={false} />);

    const before = secondaryTexts();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICK_INTERVAL_MS * 4);
    });

    // One switch, three faces — off must mean off for all of them.
    expect(secondaryTexts()).toEqual(before);
  });

  it('keeps each face inside its OWN ±₹199 band', async () => {
    /**
     * Silver (₹15,890 per kg) is a far smaller number than gold (₹1,18,420 per 10g).
     * Bounding every walk against the ANCHOR's truth would let silver wander a
     * proportionally enormous distance, so each is measured against its own rate.
     */
    render(<LiveRateCard initialRates={RATES} jitter />);

    const truths = [Number(RATES.gold18.display) / 100, Number(RATES.silver999.display) / 100];
    const band = JITTER_BAND_PAISE / 100;

    for (let tick = 0; tick < 60; tick += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TICK_INTERVAL_MS);
      });

      const shown = secondaryTexts().map((text) => {
        // The row reads "Gold 18K · 10 g ₹96,930 …" — take the rupee figure, not the delta.
        const match = /₹([\d,]+)/.exec(text);
        return Number((match?.[1] ?? '').replace(/,/g, ''));
      });

      expect(shown).toHaveLength(truths.length);
      truths.forEach((truth, i) => {
        const value = shown[i] ?? Number.NaN;
        expect(
          Math.abs(value - truth),
          `face ${i} showed ₹${value} against a true ₹${truth}`,
        ).toBeLessThanOrEqual(band);
      });
    }
  });
});

describe('the jitter loop', () => {
  it('never leaves the ±₹199 band over 300 ticks in a real render', async () => {
    render(<LiveRateCard initialRates={RATES} jitter />);

    const seen = await runFor(300);

    const truth = Number(GOLD_22_PER_10G) / 100; // rupees
    // Flat rupees, not a fraction of the rate — ±2% of this rate was ₹2,368 (Stage 6).
    const drift = JITTER_BAND_PAISE / 100;

    for (const text of seen) {
      const rupees = Number(text.replace(/[^\d]/g, ''));
      expect(rupees).toBeGreaterThanOrEqual(Math.floor(truth - drift));
      expect(rupees).toBeLessThanOrEqual(Math.ceil(truth + drift));
    }
  });

  it('pauses while the tab is hidden and resumes when it returns', async () => {
    render(<LiveRateCard initialRates={RATES} jitter />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => setTabHidden(true));

    // §4.3: "A tab left open overnight should not burn a timer 30,000 times."
    expect(vi.getTimerCount()).toBe(0);

    const whileHidden = await runFor(10);
    expect(new Set(whileHidden).size).toBe(1);

    act(() => setTabHidden(false));
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    const afterReturn = await runFor(10);
    expect(new Set(afterReturn).size).toBeGreaterThan(1);
  });

  /**
   * Phase 4's "switching metal shows the new truth, not a value drifted from the old one"
   * is retired here, not ported.
   *
   * It guarded a real bug — the walk carrying its drifted value across a metal change — but
   * Stage 4B removed the segmented control: all three rates are on screen at once, so there
   * is no switch to make and no state to carry. The assertion below is what survives of it,
   * and it guards the case that CAN still happen: a background refetch landing on a new
   * true rate must reset the walk rather than drift on from the old one.
   */
  it('a new true rate resets the walk instead of drifting from the old one', async () => {
    const { rerender } = render(<LiveRateCard initialRates={RATES} jitter />);

    // Let the value wander first, so a leaked previous value would be visible.
    await runFor(20);

    const moved = { ...RATES, gold22: { ...RATES.gold22, display: '15890000' } };
    await act(async () => {
      rerender(<LiveRateCard initialRates={moved} jitter />);
    });

    // ₹1,58,900. Anything near the old ₹1,18,420 would mean the walk survived the update.
    expect(screen.getByTestId('ticker-value')).toHaveTextContent('₹1,58,900');
  });
});

describe('timer leaks — §4.3 and the memory criterion', () => {
  it('clears every timer on unmount', async () => {
    const { unmount } = render(<LiveRateCard initialRates={RATES} jitter />);

    await runFor(3); // let the pulse timeout exist alongside the interval
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not accumulate timers across 100 mount/unmount cycles', async () => {
    for (let i = 0; i < 100; i += 1) {
      const { unmount } = render(<LiveRateCard initialRates={RATES} jitter />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      unmount();

      // Asserted every cycle rather than once at the end: a leak that starts at cycle 40
      // is easier to find than a final count that is merely "too high".
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});

describe('the disclaimer — MASTER-SPEC §8', () => {
  it('is always present', () => {
    render(<LiveRateCard initialRates={RATES} jitter />);

    expect(screen.getByText(/Indicative rate/)).toBeInTheDocument();
    expect(screen.getByText(/Final price confirmed in store/)).toBeInTheDocument();
  });

  it('survives the off-switch — it is not part of the animation', () => {
    clientEnv.NEXT_PUBLIC_TICKER_JITTER = false;
    render(<LiveRateCard initialRates={RATES} jitter />);

    expect(screen.getByText(/Final price confirmed in store/)).toBeInTheDocument();
  });

  it('renders the timestamp in the shop timezone, not the runtime one', () => {
    render(<LiveRateCard initialRates={RATES} jitter />);

    // 06:12 UTC is 11:42 AM IST — the exact example §4.4 gives. Pinning the zone is what
    // keeps the SSR string and the hydrated string identical.
    expect(screen.getByText(/11:42 AM/)).toBeInTheDocument();
  });
});
