/**
 * RateTicker — the homepage centrepiece.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.3, §4.4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  The jitter value lives in THIS COMPONENT'S STATE AND NOWHERE ELSE.
 *
 *  It is never passed as a prop, never sent to an API, never persisted. The calculator
 *  and every bill read the true rate from /api/rates. §4: "If you find yourself passing
 *  it as a prop, you have made a mistake."
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { RateDelta } from '@/components/rates/rate-delta';
import { RateDisclaimer } from '@/components/rates/rate-disclaimer';
import { Sparkline } from '@/components/rates/sparkline';
import { Card, SegmentedControl } from '@/components/ui';
import { clientEnv } from '@/lib/env';
import { formatINR } from '@/lib/money';
import { nextTick, TICK_INTERVAL_MS } from '@/lib/ticker-jitter';
import { cn } from '@/lib/utils/cn';

export interface SerialisedRate {
  perGram: string;
  display: string;
  change: string;
  effectiveAt: string;
  unit: string;
}

export type SerialisedRates = Record<'gold22' | 'gold18' | 'silver999', SerialisedRate>;

const OPTIONS = [
  { value: 'gold22', label: 'Gold 22K' },
  { value: 'gold18', label: 'Gold 18K' },
  { value: 'silver999', label: 'Silver 999' },
] as const;

type FaceKey = (typeof OPTIONS)[number]['value'];

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<SerialisedRates>);

const NO_HISTORY: Record<FaceKey, string[]> = { gold22: [], gold18: [], silver999: [] };

export function RateTicker({
  initialRates,
  history = NO_HISTORY,
}: {
  initialRates: SerialisedRates;
  /** Display-unit values per face, for the sparkline. */
  history?: Record<FaceKey, string[]>;
}) {
  const [face, setFace] = useState<FaceKey>('gold22');

  /**
   * True rates. Seeded from the ISR'd server page so the FIRST PAINT already shows real
   * numbers (§4.3) — a ticker that flashes a skeleton then fills in reads as broken.
   * Refetched every 5 minutes to stay current.
   */
  const { data } = useSWR<SerialisedRates>('/api/rates', fetcher, {
    fallbackData: initialRates,
    refreshInterval: 5 * 60 * 1000,
    revalidateOnFocus: false,
  });

  const rates = data ?? initialRates;
  const current = rates[face];
  const truth = useMemo(() => BigInt(current.display), [current.display]);

  const [displayed, setDisplayed] = useState<bigint>(truth);
  const [direction, setDirection] = useState<'up' | 'down' | 'flat'>('flat');
  const [pulse, setPulse] = useState(false);

  /**
   * Switching metal resets the walk to the new truth rather than drifting from the old.
   *
   * Adjusted during render rather than in an effect: an effect would paint the previous
   * metal's value first and then correct it, which is a visible flash of the wrong price.
   * This is React's documented "adjusting state when a prop changes" pattern.
   */
  const [seenTruth, setSeenTruth] = useState(truth);
  if (truth !== seenTruth) {
    setSeenTruth(truth);
    setDisplayed(truth);
    setDirection('flat');
  }

  /**
   * The interval reads the latest displayed value without being re-created every tick.
   * Written in an effect, never during render — a ref mutated during render breaks
   * concurrent rendering, where React may render a tree it then discards.
   */
  const displayedRef = useRef(displayed);
  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    if (!clientEnv.NEXT_PUBLIC_TICKER_JITTER) return;

    /**
     * Reduced motion switches the jitter off entirely (§4.3), not just its transition.
     * The global CSS in globals.css kills animations but cannot stop a setInterval — a
     * per-second number change is exactly what someone with vestibular sensitivity asked
     * the OS to prevent.
     */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        const tick = nextTick(displayedRef.current, truth);
        setDisplayed(tick.value);
        setDirection(tick.direction);
        setPulse(true);
      }, TICK_INTERVAL_MS);
    };

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    /**
     * Pause when the tab is hidden (§4.3). A tab left open overnight would otherwise burn
     * ~30,000 timer callbacks and re-render on every one.
     */
    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    // React strict mode double-invokes effects in development; without this cleanup the
    // second mount leaves the first interval running forever.
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [truth]);

  useEffect(() => {
    if (!pulse) return;
    const timeout = setTimeout(() => setPulse(false), 400);
    return () => clearTimeout(timeout);
  }, [pulse]);

  const change = BigInt(current.change);
  const changeUp = change >= 0n;
  const points = (history[face] ?? []).map(BigInt);

  return (
    // The three test ids are a deliberate seam. The headline figure is a formatted currency
    // string with no accessible name, so an E2E test would otherwise have to match on
    // `p[aria-live]` or on the digits themselves — both of which break the moment the
    // markup or the rate changes, and neither of which says what it is looking for.
    <Card className="flex flex-col gap-6" data-testid="rate-ticker">
      <SegmentedControl
        label="Metal and purity"
        options={OPTIONS}
        value={face}
        onChange={(v) => setFace(v)}
      />

      <div className="flex flex-col gap-2">
        <div
          className={cn(
            'rounded-field px-2 py-1 transition-colors duration-slow ease-standard',
            pulse && (direction === 'up' ? 'bg-up/10' : 'bg-down/10'),
          )}
        >
          <p
            className={cn(
              'text-display font-semibold tabular tracking-tight',
              direction === 'up' && 'text-up',
              direction === 'down' && 'text-down',
              direction === 'flat' && 'text-ink',
            )}
            /**
             * Announced politely, never assertively (Phase 9 §9.7). A per-second
             * assertive region interrupts a screen reader continuously and makes the
             * page unusable.
             */
            aria-live="polite"
            aria-atomic="true"
            data-testid="ticker-value"
          >
            {formatINR(displayed)}
          </p>
          <p className="text-small text-muted" data-testid="ticker-unit">
            {current.unit}
          </p>
        </div>

        {/* The TRUE change against the previous admin rate — never the jitter's
            per-tick direction, which is noise and would show a "▼ 2%" fall that never
            happened. `direction` above colours the number; this line reports reality. */}
        <RateDelta change={change} base={truth} />

        {/*
          The slot is always reserved, even when there is nothing to draw.

          Rendering the sparkline conditionally made the card change height when switching
          between a metal with rate history and one without — a visible jump, and exactly
          the layout shift §4 TEST asserts against. It only surfaced once the Phase 7 admin
          tests gave one purity a second rate row, which is the kind of state a fixed
          fixture never produces.
        */}
        <div className="h-8">
          {points.length >= 2 && <Sparkline points={points} rising={changeUp} />}
        </div>
      </div>

      {/*
        Always visible, never hidden in 10px grey (§4 DESIGN). MASTER-SPEC §8: the
        disclaimer plus the calculator using true rates is the mitigation for displaying
        a price that differs from the transaction price. Do not remove it.

        Shared with /rates so §4.6's "the same disclaimer" cannot quietly stop being true.
        It formats in IST explicitly — this component is server-rendered before it
        hydrates, and a UTC server against an IST browser would print two different times
        for the same instant and blow up hydration.
      */}
      <RateDisclaimer effectiveAt={current.effectiveAt} />
    </Card>
  );
}
