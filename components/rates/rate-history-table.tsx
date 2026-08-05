/**
 * RateHistoryTable — 30 days of recorded rate changes.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.6).
 *
 * The client island on an otherwise ISR'd page (MASTER-SPEC §6). All three metals' rows
 * arrive from the server; the only client state is which one is on screen — so switching
 * metal is instant and costs no request.
 *
 * A real `<table>`, not a grid of divs: this is tabular data, and a screen reader announcing
 * "Date, 5 Aug 2026, Rate, ₹1,18,420" is the whole point of the element.
 */
'use client';

import { useState } from 'react';

import { EmptyState, SegmentedControl } from '@/components/ui';
import { formatShopDateTime } from '@/lib/datetime';
import { formatINR } from '@/lib/money';
import { cn } from '@/lib/utils/cn';

export interface HistoryRow {
  at: string;
  /** Display-unit paise, as a string — bigint does not survive the server→client boundary. */
  rate: string;
  /** Signed change against the previous row, same unit. `null` on the oldest row. */
  change: string | null;
}

export interface HistoryFace {
  key: string;
  label: string;
  unit: string;
  /** Newest first. */
  rows: HistoryRow[];
}

export function RateHistoryTable({
  faces,
  days,
}: {
  faces: readonly HistoryFace[];
  days: number;
}) {
  const [key, setKey] = useState(faces[0]?.key ?? '');
  const face = faces.find((f) => f.key === key) ?? faces[0];

  if (!face) return null;

  const options = faces.map((f) => ({ value: f.key, label: f.label }));

  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        label="History for metal and purity"
        options={options}
        value={face.key}
        onChange={setKey}
      />

      {face.rows.length === 0 ? (
        <EmptyState
          title="No changes recorded yet"
          description={`No ${face.label} rate has been set in the last ${days} days.`}
        />
      ) : (
        // Scrolls inside its own box rather than pushing the page sideways — the 375px
        // no-horizontal-scroll assertion is on the document, not on this container.
        <div className="overflow-x-auto">
          <table className="w-full text-small tabular">
            <caption className="sr-only">
              {face.label} rate changes over the last {days} days, {face.unit}, newest
              first.
            </caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-2 text-left font-medium">
                  Date
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Rate
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {face.rows.map((row) => (
                <tr key={row.at} className="border-b border-line last:border-0">
                  <th
                    scope="row"
                    className="py-2 pr-4 text-left font-normal whitespace-nowrap text-ink"
                  >
                    <time dateTime={row.at}>{formatShopDateTime(row.at)}</time>
                  </th>
                  <td className="py-2 text-right font-medium whitespace-nowrap text-ink">
                    {formatINR(BigInt(row.rate))}
                  </td>
                  <td className="py-2 pl-4 text-right whitespace-nowrap">
                    <ChangeCell change={row.change} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The oldest row in the window has nothing before it to compare against — say so. */
function ChangeCell({ change }: { change: string | null }) {
  if (change === null) {
    return (
      <span className="text-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No earlier rate to compare</span>
      </span>
    );
  }

  const value = BigInt(change);
  const direction = value > 0n ? 'up' : value < 0n ? 'down' : 'flat';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        direction === 'up' && 'text-up',
        direction === 'down' && 'text-down',
        direction === 'flat' && 'text-muted',
      )}
    >
      {/* Arrow plus word, never colour alone — §4 DESIGN. */}
      <span aria-hidden="true">{{ up: '▲', down: '▼', flat: '–' }[direction]}</span>
      <span className="sr-only">
        {{ up: 'Up', down: 'Down', flat: 'Unchanged' }[direction]}
      </span>
      {formatINR(value < 0n ? -value : value)}
    </span>
  );
}
