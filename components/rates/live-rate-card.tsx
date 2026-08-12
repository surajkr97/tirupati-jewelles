/**
 * LiveRateCard — the rate centrepiece, on the homepage and on /rates.
 * Created by the UI redesign, Stage 4B. Replaces Phase 4's `RateTicker` presentation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  The jitter value lives in THIS COMPONENT'S STATE AND NOWHERE ELSE.
 *
 *  It is never passed as a prop, never sent to an API, never persisted. The calculator
 *  and every bill read the true rate from /api/rates. §4: "If you find yourself passing
 *  it as a prop, you have made a mistake."
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What changed, and what it cost ──
 *
 * Phase 4 showed ONE metal at a time behind a segmented control. The redesign shows all
 * three at once, with 22K as the anchor — brief §5's hierarchy, and the reference's
 * composition. That is strictly more information: the two secondary rates used to require
 * an interaction to see, and a customer checking gold against silver had to toggle twice.
 *
 * Removing the control removed the bug class its tests guarded — "switching metal shows the
 * new truth, not a value drifted from the old one" cannot happen when there is nothing to
 * switch. Those tests are retired rather than patched; the jitter tests they sat beside are
 * untouched and still pass.
 *
 * ── Jitter applies to all three faces, on one switch ──
 *
 * Phase 4 moved whichever metal was selected; Stage 4B narrowed that to the 22K anchor while
 * 18K and silver sat still. The owner asked for all three to move together, so one walk runs
 * per face — each bounded against ITS OWN true rate, so the ±₹199 band means the same thing
 * on a ₹1.18L gold rate and a ₹95k silver one.
 *
 * One switch, three faces, deliberately: a per-metal control would let the card show a
 * moving gold rate beside a frozen silver one, which reads as a broken row rather than as a
 * choice, and it would multiply the MASTER-SPEC §8 off-switch into three things to get wrong.
 *
 * ── What turns it off ──
 *
 * `jitter` — resolved on the server from `Settings.tickerJitter`, falling back to
 * `NEXT_PUBLIC_TICKER_JITTER`. That column existed since §7.9 and nothing read it: this
 * component consulted the environment variable directly, so the admin toggle wrote an
 * audited value that changed nothing. See `getTickerJitter` in `lib/settings.ts`.
 *
 * Reduced motion disables it regardless, and `/rates` passes `jitter={false}` outright.
 */
'use client';

import { ArrowRight, Calculator, History, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { RateDelta } from '@/components/rates/rate-delta';
import { RateDisclaimer } from '@/components/rates/rate-disclaimer';
import { Sparkline } from '@/components/rates/sparkline';
import { Card } from '@/components/ui';
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

export type FaceKey = 'gold22' | 'gold18' | 'silver999';
export type SerialisedRates = Record<FaceKey, SerialisedRate>;

/** Labels are presentation, so they live here rather than being serialised per request. */
const LABELS: Record<FaceKey, string> = {
  gold22: 'Gold 22K (916)',
  gold18: 'Gold 18K',
  silver999: 'Silver 999',
};

/**
 * Short unit labels for the secondary rows.
 *
 * `unitLabel()` returns "per 10 grams" / "per 1 kilogram", which is right on the anchor
 * where there is a whole line for it. On a secondary row at 320px the label shares that line
 * with a price and a delta, and the full string collapsed to one word per line — "Gold /
 * 18K / · / per / 10 / grams". Measured, not guessed: it is what the first render produced.
 *
 * Derived here rather than in `lib/rates.ts` — the long form is what the calculator, the
 * bill and the admin all use, and this is a presentation concern for one row.
 */
const SHORT_UNIT: Record<string, string> = {
  'per 10 grams': '10 g',
  'per 1 kilogram': '1 kg',
};

/** The anchor: the rate this shop is asked for more than the other two combined. */
const ANCHOR: FaceKey = 'gold22';
const SECONDARY: FaceKey[] = ['gold18', 'silver999'];

/** Every face, anchor first. The jitter loop walks all of them. */
const FACES: FaceKey[] = [ANCHOR, ...SECONDARY];

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<SerialisedRates>);

const NO_HISTORY: Record<FaceKey, string[]> = { gold22: [], gold18: [], silver999: [] };

export interface LiveRateCardProps {
  initialRates: SerialisedRates;
  /** Display-unit values per face, for the anchor's sparkline. */
  history?: Record<FaceKey, string[]>;
  /**
   * Hide the "Rate history" action.
   *
   * `/rates` IS the rate history page, so the link there would point at the page you are
   * already on — brief §10's "no buttons that do nothing", in its quietest form.
   */
  showHistoryLink?: boolean;
  /**
   * The card's own label, or `null` to omit it.
   *
   * `/rates` passes `null`: that page's `h1` already says "Today's rates", and the card
   * repeating it two lines below gave the page the same sentence twice — as an `h1` and an
   * `h2`. It also made `getByRole('heading', { name: /Today.s rates/ })` ambiguous, which is
   * how it was found. The homepage keeps the label, because there the card has to name
   * itself.
   */
  heading?: string | null;
  /**
   * Whether the displayed rates may walk around the true ones.
   *
   * Resolved on the server (`getTickerJitter`) so the owner's dashboard setting is what
   * decides, rather than the build-time environment variable this component used to read on
   * its own. Defaults to `false`: a caller that has not thought about it gets the still,
   * truthful card, which is the safe direction for a number MASTER-SPEC §8 governs.
   */
  jitter?: boolean;
}

export function LiveRateCard({
  initialRates,
  history = NO_HISTORY,
  showHistoryLink = true,
  heading = "Today's rates",
  jitter = false,
}: LiveRateCardProps) {
  /**
   * True rates. Seeded from the ISR'd server page so the FIRST PAINT already shows real
   * numbers (§4.3) — a card that flashes a skeleton then fills in reads as broken.
   * Refetched every 5 minutes to stay current.
   */
  const { data, mutate, isValidating } = useSWR<SerialisedRates>('/api/rates', fetcher, {
    fallbackData: initialRates,
    refreshInterval: 5 * 60 * 1000,
    revalidateOnFocus: false,
  });

  const rates = data ?? initialRates;
  const anchor = rates[ANCHOR];

  /**
   * The true rate for every face, not just the anchor — each walk is bounded against its own.
   *
   * That is the whole reason this is a record rather than three variables: the ±₹199 band is
   * measured per face, so silver never borrows gold's headroom.
   */
  const truths = useMemo(
    () =>
      Object.fromEntries(FACES.map((key) => [key, BigInt(rates[key].display)])) as Record<
        FaceKey,
        bigint
      >,
    [rates],
  );
  const truth = truths[ANCHOR];

  const [displayed, setDisplayed] = useState<Record<FaceKey, bigint>>(truths);
  const [pulse, setPulse] = useState(false);

  /**
   * A refetch that lands on a new rate resets the walk to it rather than drifting from the
   * old one. Adjusted during render, not in an effect: an effect would paint the previous
   * value first and then correct it, which is a visible flash of the wrong price.
   *
   * Compared per face and reset wholesale — the three rates are saved together, so a partial
   * reset would leave two faces walking from the previous morning's numbers.
   */
  const [seenTruths, setSeenTruths] = useState(truths);
  if (FACES.some((key) => truths[key] !== seenTruths[key])) {
    setSeenTruths(truths);
    setDisplayed(truths);
  }

  /**
   * The interval reads the latest displayed values without being re-created every tick.
   * Written in an effect, never during render — a ref mutated during render breaks
   * concurrent rendering, where React may render a tree it then discards.
   */
  const displayedRef = useRef(displayed);
  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    if (!jitter) return;

    /**
     * Reduced motion switches the jitter off entirely (§4.3), not just its transition. The
     * global CSS kills animations but cannot stop a setInterval — a per-second number change
     * is exactly what someone with vestibular sensitivity asked the OS to prevent.
     */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        // One tick advances every face, so the three rows move together rather than
        // shimmering out of step with each other.
        const current = displayedRef.current;
        setDisplayed(
          Object.fromEntries(
            FACES.map((key) => [key, nextTick(current[key], truths[key]).value]),
          ) as Record<FaceKey, bigint>,
        );
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
  }, [jitter, truths]);

  useEffect(() => {
    if (!pulse) return;
    const timeout = setTimeout(() => setPulse(false), 400);
    return () => clearTimeout(timeout);
  }, [pulse]);

  const anchorPoints = (history[ANCHOR] ?? []).map(BigInt);

  return (
    // `rate-ticker`, `ticker-value` and `ticker-unit` are a deliberate seam kept from Phase
    // 4: the headline figure is a formatted currency string with no accessible name, so a
    // test would otherwise match on `p[aria-live]` or on the digits themselves — both of
    // which break the moment the markup or the rate changes.
    <Card className="flex flex-col gap-6" data-testid="rate-ticker" padded={false}>
      <div className="flex flex-col gap-6 p-6 md:p-8">
        <header className="flex items-center justify-between gap-4">
          {/*
            "Today's rates", never "live".

            MASTER-SPEC §1 puts live market rate APIs out of scope and the figure is typed
            in by the shop. Brief §2 says the same. The reference image's "LIVE RATES" label
            is the one piece of it that cannot be followed here.
          */}
          {heading ? (
            <h2 className="text-small font-semibold tracking-[0.08em] text-rose-deep uppercase">
              {heading}
            </h2>
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={() => void mutate()}
            disabled={isValidating}
            aria-label="Refresh rates"
            className={cn(
              'grid size-tap shrink-0 place-items-center rounded-pill',
              'text-muted transition-colors duration-fast ease-standard',
              'hover:bg-rose-tint hover:text-ink disabled:opacity-40',
            )}
          >
            <RefreshCw
              className={cn('size-4', isValidating && 'animate-spin')}
              aria-hidden="true"
            />
          </button>
        </header>

        {/* ── The anchor ── */}
        <div className="flex flex-col gap-2">
          {/*
            ── The visual figure is hidden from assistive technology ──

            The jittered value is a cosmetic shimmer (MASTER-SPEC §8). Announcing it would
            make a screen reader the one surface in the application that states a fabricated
            rate as fact — the consumer-protection exposure DEBT-002 is about, not merely an
            annoyance. `aria-live="off"` is not enough: it stops the ANNOUNCEMENT of changes
            but leaves the wrong number readable on demand.

            The label and unit are inside the hidden block too, because the sr-only sentence
            below carries all three together — leaving them out here would have a screen
            reader hear the label twice.
          */}
          <div aria-hidden="true">
            <p className="text-body text-muted">
              <span className="font-medium text-ink">{LABELS[ANCHOR]}</span>
              {' · '}
              <span data-testid="ticker-unit">{anchor.unit}</span>
            </p>
          </div>

          {/*
            What a screen reader actually gets: the TRUE rate, announced only when it
            changes — which is when the shop changes it, at most once per SWR refresh
            (5 minutes), not once per second.
          */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {LABELS[ANCHOR]}: {formatINR(truth)} {anchor.unit}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <p
              aria-hidden="true"
              data-testid="ticker-value"
              className={cn(
                'font-semibold tracking-tight text-ink num',
                'text-h1 md:text-display',
                'transition-opacity duration-fast ease-standard',
                pulse && 'opacity-90',
              )}
            >
              {formatINR(displayed[ANCHOR])}
            </p>

            <RateDelta
              change={BigInt(anchor.change)}
              base={BigInt(anchor.display)}
              className="shrink-0 rounded-pill bg-rose-tint px-4 py-1 text-small"
            />
          </div>

          {anchorPoints.length >= 2 && (
            <Sparkline
              points={anchorPoints}
              rising={BigInt(anchor.change) >= 0n}
              tone="brand"
              className="mt-2 w-full"
            />
          )}
        </div>

        {/* ── The other two, as rows rather than as two more cards ── */}
        <ul className="flex flex-col">
          {SECONDARY.map((key) => {
            const face = rates[key];
            return (
              <li
                key={key}
                /**
                 * Stacked below `sm`, one line above it.
                 *
                 * At 320px a single row has to hold a label, a price and a delta carrying
                 * both ₹ and %. It cannot: the label was squeezed to one word per line
                 * ("Gold / 18K / · / 10 / g") even after the unit was shortened. Two lines
                 * on a phone and one on anything wider is the same information in the shape
                 * each width can actually hold (brief §22).
                 */
                className="flex flex-col gap-1 border-t border-line py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <p className="text-body text-muted">
                  <span className="font-medium whitespace-nowrap text-ink">
                    {LABELS[key]}
                  </span>
                  {' · '}
                  <span className="whitespace-nowrap">
                    {SHORT_UNIT[face.unit] ?? face.unit}
                  </span>
                </p>
                <div className="flex shrink-0 items-center gap-4">
                  <p
                    className={cn(
                      'text-h3 font-semibold text-ink num transition-opacity duration-fast',
                      pulse && 'opacity-90',
                    )}
                  >
                    {formatINR(displayed[key])}
                  </p>
                  <RateDelta
                    change={BigInt(face.change)}
                    base={BigInt(face.display)}
                    className="text-small"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/*
        ── Actions ──

        One column when there is one action. `sm:grid-cols-2` unconditionally left the lone
        "Calculate at this rate" occupying half the card on /rates, with its trailing arrow
        stranded in the middle of a white expanse.
      */}
      <div
        className={cn('grid border-t border-line', showHistoryLink && 'sm:grid-cols-2')}
      >
        <RateAction
          href="/calculator"
          icon={<Calculator className="size-icon" aria-hidden="true" />}
          title="Calculate at this rate"
          detail="Price a piece by weight"
        />
        {showHistoryLink && (
          <RateAction
            href="/rates"
            icon={<History className="size-icon" aria-hidden="true" />}
            title="Rate history"
            detail="The last 30 days"
            className="border-t border-line sm:border-t-0 sm:border-l"
          />
        )}
      </div>

      <div className="px-6 pb-6 md:px-8 md:pb-8">
        <RateDisclaimer effectiveAt={anchor.effectiveAt} />
      </div>
    </Card>
  );
}

function RateAction({
  href,
  icon,
  title,
  detail,
  className,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-4 p-6 md:px-8',
        'transition-colors duration-fast ease-standard hover:bg-rose-tint',
        className,
      )}
    >
      <span className="grid size-tap shrink-0 place-items-center rounded-field bg-rose-tint text-rose-deep">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-body font-medium text-ink">{title}</span>
        <span className="text-small text-muted">{detail}</span>
      </span>
      <ArrowRight
        className="ml-auto size-4 shrink-0 text-rose-deep transition-transform duration-fast ease-standard group-hover:translate-x-1"
        aria-hidden="true"
      />
    </Link>
  );
}
