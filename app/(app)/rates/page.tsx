/**
 * /rates — the reference page for today's metal rates.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.6).
 *
 * ISR 300 + a client island (MASTER-SPEC §6): the cards are static HTML on the true rate,
 * and the only interactive part is which metal's history table is on screen.
 *
 * ASSUMPTION: no jitter here. §4.6 does not ask for it and MASTER-SPEC §8 scopes the
 * fluctuation to "the homepage widget". This is the page a customer opens to check a
 * number before walking into the shop, so it shows the figure the shop will actually
 * quote, sitting still. The disclaimer is still present — §4.6 requires it, and the rate
 * can move between the ISR window and the customer arriving.
 */
import type { Metadata } from 'next';

import { LiveRateCard } from '@/components/rates/live-rate-card';
import {
  RateHistoryTable,
  type HistoryFace,
  type HistoryRow,
} from '@/components/rates/rate-history-table';
import { Section } from '@/components/shell';
import { buttonClasses } from '@/components/ui';
import Link from 'next/link';
import { formatShopDateTime, hasRealTimestamp } from '@/lib/datetime';
import { getCurrentRates, getRateHistory, RATE_FACES } from '@/lib/rates';
import { serialiseRates } from '@/lib/rates-view';
import { canonical } from '@/lib/seo';
import { cn } from '@/lib/utils/cn';

export const revalidate = 300;

/** §4.6: "History table: date, rate, change. Last 30 days." */
const HISTORY_DAYS = 30;

/** The sparkline on each card stays on the 7-day window the ticker uses (§4.4). */
const SPARKLINE_DAYS = 7;

export const metadata: Metadata = {
  ...canonical('/rates'),
  title: 'Gold & silver rates today',
  description:
    'Indicative gold 22K, gold 18K and silver 999 rates. Final price confirmed in store.',
};

/**
 * Turn an ascending series into newest-first rows carrying the change against the row
 * before them. Done on the server so the client island only renders.
 */
function toHistoryRows(points: { at: string; rate: bigint }[]): HistoryRow[] {
  return points
    .map((point, index) => {
      const previous = index > 0 ? points[index - 1] : undefined;
      return {
        at: point.at,
        rate: point.rate.toString(),
        // The oldest row in the window has nothing before it. `null`, not 0 — a 0 would
        // claim the rate was unchanged when the truth is that we did not look further back.
        change: previous ? (point.rate - previous.rate).toString() : null,
      } satisfies HistoryRow;
    })
    .reverse();
}

export default async function RatesPage() {
  const rates = await getCurrentRates();
  const serialisedRates = serialiseRates(rates);

  const faces = await Promise.all(
    RATE_FACES.map(async ({ key, metal, purity, label, unit }) => {
      const [history, sparkline] = await Promise.all([
        getRateHistory(metal, purity, HISTORY_DAYS),
        getRateHistory(metal, purity, SPARKLINE_DAYS),
      ]);

      return {
        key,
        label,
        unit,
        face: rates[key],
        points: sparkline.map((point) => point.rate),
        rows: toHistoryRows(history),
      };
    }),
  );

  // "Rates last updated", prominent (§4.6). The newest of the three — a customer wants to
  // know how fresh the page is, not to audit each purity separately.
  const lastUpdated = faces
    .map((f) => f.face.effectiveAt)
    .filter(hasRealTimestamp)
    .sort()
    .at(-1);

  /**
   * The anchor's sparkline points, in the shape `LiveRateCard` reads.
   *
   * The page already fetched these for the cards it used to render one-per-metal; passing
   * them here means the sparkline is drawn from the same 7-day window the homepage uses,
   * with no extra query.
   */
  const sparklines = Object.fromEntries(
    faces.map(({ key, points }) => [key, points.map((p) => p.toString())]),
  ) as Record<'gold22' | 'gold18' | 'silver999', string[]>;

  const historyFaces: HistoryFace[] = faces.map(({ key, label, unit, rows }) => ({
    key,
    label,
    unit,
    rows,
  }));

  return (
    <>
      <Section className="pt-8 pb-0 md:pt-12">
        <div className="flex flex-col gap-2">
          {/* Editorial serif, matching the storefront's other page headings (Stage 4A). */}
          <h1 className="font-display text-h1 font-medium tracking-tight text-ink md:text-h1-lg">
            Today&rsquo;s rates
          </h1>
          {/* Prominent, not a footnote — §4.6 asks for exactly this line. */}
          <p className="text-lead text-muted">
            {lastUpdated ? (
              <>
                Rates last updated{' '}
                <time dateTime={lastUpdated} className="font-medium text-ink tabular">
                  {formatShopDateTime(lastUpdated)}
                </time>
              </>
            ) : (
              'No rates have been published yet.'
            )}
          </p>
        </div>
      </Section>

      {/*
        One card, not three.

        §4.6 asked for three cards stacked on mobile, and Phase 4 delivered exactly that.
        The redesign replaces them with the same `LiveRateCard` the homepage uses: brief §5
        wants a single anchor rate that reads in one second, and three equal cards give three
        equal anchors and therefore none. `showHistoryLink` is off because this IS the
        history page — brief §10's "no buttons that do nothing".

        `LiveRateCard` carries its own disclaimer, which is what §4.6 requires of this page.
        The jitter is switched off here by the same rule as before: MASTER-SPEC §8 scopes the
        fluctuation to the homepage widget, and this is the page a customer opens to check a
        figure before walking into the shop. See the note in `live-rate-card.tsx`.
      */}
      <Section className="py-8 md:py-12">
        <LiveRateCard
          initialRates={serialisedRates}
          history={sparklines}
          showHistoryLink={false}
          /* Explicit, because it used to be a claim in a comment with nothing behind it: the
             note above said the jitter was "switched off here" while the card read the env
             flag on its own and moved regardless. `jitter` now defaults to false, and this
             says so at the call site rather than relying on that default. */
          jitter={false}
          // The page's h1 already says this; see the prop's note.
          heading={null}
        />
      </Section>

      <Section display eyebrow="History" heading={`Last ${HISTORY_DAYS} days`}>
        <RateHistoryTable faces={historyFaces} days={HISTORY_DAYS} />
      </Section>

      {/* The page's one outward action. §11 puts the calculator CTA last, and it is the
          thing a customer who has just read a rate actually wants next. */}
      <Section className="pb-16">
        {/* Stage 6: was a wine block. §1 takes wine off the storefront; the section still
            reads as the page's one outward action through type and a hairline border. */}
        <div className="flex flex-col items-start gap-4 rounded-card border border-line bg-sand p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex flex-col gap-1">
            <p className="font-display text-h2 font-medium text-ink">
              Price a piece at this rate
            </p>
            <p className="text-body text-muted">
              Add weight and making charge for an itemised estimate.
            </p>
          </div>
          <Link
            href="/calculator"
            className={cn(buttonClasses({ variant: 'primary' }), 'shrink-0')}
          >
            Open the calculator
          </Link>
        </div>
      </Section>
    </>
  );
}
