/**
 * RateDelta — `▲ ₹142 (0.21%)`.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.4, §4.6).
 *
 * Shared by the homepage ticker and the /rates cards so the two cannot disagree about what
 * "up" looks like.
 *
 * §4 DESIGN: "Colour is not the only up/down signal — arrows carry it too." The arrow is
 * `aria-hidden` and paired with an sr-only word, so the direction survives both colour
 * blindness and a screen reader.
 */
import { formatINR, formatPercent } from '@/lib/money';
import { cn } from '@/lib/utils/cn';

export function RateDelta({
  change,
  base,
  className,
}: {
  /** Signed change in the display unit, in paise. */
  change: bigint;
  /** The value the percentage is measured against, same unit. */
  base: bigint;
  className?: string;
}) {
  // Zero is its own case. A green ▲ against ₹0 claims a rise that did not happen, and on a
  // freshly seeded shop every metal starts there.
  const direction = change > 0n ? 'up' : change < 0n ? 'down' : 'flat';

  const glyph = { up: '▲', down: '▼', flat: '–' }[direction];
  const word = { up: 'Up', down: 'Down', flat: 'Unchanged' }[direction];

  return (
    <p
      className={cn(
        'flex items-center gap-1 text-body font-medium tabular',
        direction === 'up' && 'text-up',
        direction === 'down' && 'text-down',
        direction === 'flat' && 'text-muted',
        className,
      )}
    >
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{word}</span>
      {formatINR(change < 0n ? -change : change)} ({formatPercent(change, base)})
    </p>
  );
}
