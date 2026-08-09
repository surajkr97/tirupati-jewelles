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

import { RateCard } from '@/components/rates/rate-card';
import {
  RateHistoryTable,
  type HistoryFace,
  type HistoryRow,
} from '@/components/rates/rate-history-table';
import { Section } from '@/components/shell';
import { formatShopDateTime, hasRealTimestamp } from '@/lib/datetime';
import { getCurrentRates, getRateHistory, RATE_FACES } from '@/lib/rates';
import { canonical } from '@/lib/seo';

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
          <h1 className="text-h1 font-semibold tracking-tight text-ink md:text-h1-lg">
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

      {/* Stacked on mobile — §4.6. Three across only once there is room for it. */}
      <Section className="py-8 md:py-12">
        <div className="grid gap-4 md:grid-cols-3">
          {faces.map(({ key, label, unit, face, points }) => (
            <RateCard
              key={key}
              label={label}
              display={face.display}
              unit={unit}
              change={face.change}
              effectiveAt={face.effectiveAt}
              points={points}
            />
          ))}
        </div>
      </Section>

      <Section eyebrow="History" heading={`Last ${HISTORY_DAYS} days`}>
        <RateHistoryTable faces={historyFaces} days={HISTORY_DAYS} />
      </Section>
    </>
  );
}
