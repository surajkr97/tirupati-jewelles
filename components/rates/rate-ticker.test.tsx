/**
 * @vitest-environment jsdom
 *
 * Phase 4 TEST — the ticker's timer lifecycle and the off-switch.
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

import { act, cleanup, render, screen } from '@testing-library/react';
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

vi.mock('swr', () => ({
  default: (_key: string, _fetcher: unknown, options?: { fallbackData?: unknown }) => ({
    data: options?.fallbackData,
  }),
}));

import { RateTicker, type SerialisedRates } from '@/components/rates/rate-ticker';
import { JITTER_CLAMP } from '@/lib/ticker-jitter';

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

describe('the off-switch — NEXT_PUBLIC_TICKER_JITTER', () => {
  it('holds the value constant for 10s when the flag is false', async () => {
    clientEnv.NEXT_PUBLIC_TICKER_JITTER = false;
    render(<RateTicker initialRates={RATES} />);

    const seen = await runFor(10);

    // MASTER-SPEC §8: "Ship with a working off-switch." It is the mitigation of last
    // resort for the consumer-protection exposure, so it must be genuinely inert.
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe('₹1,18,420');
  });

  it('creates no interval at all when the flag is false', async () => {
    clientEnv.NEXT_PUBLIC_TICKER_JITTER = false;
    render(<RateTicker initialRates={RATES} />);

    // Not merely "the number did not change" — nothing is scheduled to change it.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the positive control: with the flag on, the value does move', async () => {
    render(<RateTicker initialRates={RATES} />);

    const seen = await runFor(10);

    // Without this, both assertions above would also pass on a ticker that never mounted.
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});

describe('prefers-reduced-motion', () => {
  it('produces no jitter even with the flag on', async () => {
    stubReducedMotion(true);
    render(<RateTicker initialRates={RATES} />);

    const seen = await runFor(10);

    // §4.3 requires no jitter at all here. The global CSS override in globals.css stops
    // animations but cannot stop a setInterval, so this has to be a JS decision — and a
    // per-second number change is precisely what a vestibular-sensitivity user has asked
    // the OS to prevent.
    expect(new Set(seen).size).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the jitter loop', () => {
  it('never leaves the ±2% band over 300 ticks in a real render', async () => {
    render(<RateTicker initialRates={RATES} />);

    const seen = await runFor(300);

    const truth = Number(GOLD_22_PER_10G) / 100; // rupees
    const drift = truth * JITTER_CLAMP;

    for (const text of seen) {
      const rupees = Number(text.replace(/[^\d]/g, ''));
      expect(rupees).toBeGreaterThanOrEqual(Math.floor(truth - drift));
      expect(rupees).toBeLessThanOrEqual(Math.ceil(truth + drift));
    }
  });

  it('pauses while the tab is hidden and resumes when it returns', async () => {
    render(<RateTicker initialRates={RATES} />);
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

  it('switching metal shows the new truth, not a value drifted from the old one', async () => {
    render(<RateTicker initialRates={RATES} />);

    // Let the gold value wander first, so a leaked previous value would be visible.
    await runFor(20);

    await act(async () => {
      screen.getByRole('radio', { name: 'Silver 999' }).click();
    });

    // Silver's true rate is ₹1,58,900/kg. Anything near gold's ₹1,18,420 would mean the
    // walk carried across the switch.
    expect(screen.getByTestId('ticker-value')).toHaveTextContent('₹1,58,900');
    expect(screen.getByTestId('ticker-unit')).toHaveTextContent('per 1 kilogram');
  });
});

describe('timer leaks — §4.3 and the memory criterion', () => {
  it('clears every timer on unmount', async () => {
    const { unmount } = render(<RateTicker initialRates={RATES} />);

    await runFor(3); // let the pulse timeout exist alongside the interval
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not accumulate timers across 100 mount/unmount cycles', async () => {
    for (let i = 0; i < 100; i += 1) {
      const { unmount } = render(<RateTicker initialRates={RATES} />);
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
    render(<RateTicker initialRates={RATES} />);

    expect(screen.getByText(/Indicative rate/)).toBeInTheDocument();
    expect(screen.getByText(/Final price confirmed in store/)).toBeInTheDocument();
  });

  it('survives the off-switch — it is not part of the animation', () => {
    clientEnv.NEXT_PUBLIC_TICKER_JITTER = false;
    render(<RateTicker initialRates={RATES} />);

    expect(screen.getByText(/Final price confirmed in store/)).toBeInTheDocument();
  });

  it('renders the timestamp in the shop timezone, not the runtime one', () => {
    render(<RateTicker initialRates={RATES} />);

    // 06:12 UTC is 11:42 AM IST — the exact example §4.4 gives. Pinning the zone is what
    // keeps the SSR string and the hydrated string identical.
    expect(screen.getByText(/11:42 AM/)).toBeInTheDocument();
  });
});
