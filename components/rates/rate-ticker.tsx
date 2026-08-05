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

import { Sparkline } from '@/components/rates/sparkline';
import { Card, SegmentedControl } from '@/components/ui';
import { clientEnv } from '@/lib/env';
import { formatINR, formatPercent } from '@/lib/money';
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

  const updatedAt = new Date(current.effectiveAt).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Card className="flex flex-col gap-6">
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
          >
            {formatINR(displayed)}
          </p>
          <p className="text-small text-muted">{current.unit}</p>
        </div>

        <p
          className={cn(
            'flex items-center gap-1 text-body font-medium tabular',
            changeUp ? 'text-up' : 'text-down',
          )}
        >
          {/* The arrow carries the meaning as well as the colour — §4 DESIGN requires
              up/down to be legible to a colour-blind reader. */}
          <span aria-hidden="true">{changeUp ? '▲' : '▼'}</span>
          <span className="sr-only">{changeUp ? 'Up' : 'Down'}</span>
          {formatINR(change < 0n ? -change : change)} ({formatPercent(change, truth)})
        </p>

        {points.length >= 2 && <Sparkline points={points} rising={changeUp} />}
      </div>

      {/*
        Always visible, never hidden in 10px grey (§4 DESIGN). MASTER-SPEC §8: the
        disclaimer plus the calculator using true rates is the mitigation for displaying
        a price that differs from the transaction price. Do not remove it.
      */}
      <p className="text-small text-muted">
        Indicative rate · Updated {updatedAt} · Final price confirmed in store.
      </p>
    </Card>
  );
}
