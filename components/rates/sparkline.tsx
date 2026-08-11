/**
 * Sparkline — hand-rolled SVG.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.4).
 *
 * §4 Dependencies: "prefer hand-rolled, it is ~30 lines and avoids a 100kb dependency for
 * one decorative line." It is decoration, not a chart: no axes, no grid, no labels, and
 * `aria-hidden` because the number beside it already says everything.
 */
import { cn } from '@/lib/utils/cn';

export function Sparkline({
  points,
  className,
  rising = true,
  tone = 'movement',
}: {
  points: bigint[];
  className?: string;
  rising?: boolean;
  /**
   * Draw in the brand accent instead of the up/down semantic colours.
   *
   * The line is `aria-hidden` decoration and always sits directly beneath a `RateDelta`
   * that states the direction three ways — arrow, word and colour — so a rose stroke loses
   * no information here. Brief §8 asks for exactly that: thin, restrained, rose. Callers
   * that render a sparkline WITHOUT a delta beside it should leave this off and keep the
   * semantic colouring.
   *
   * `rose` and not `rose-deep`: this is a 1.5px non-text mark on white, where rose measures
   * 4.13:1 — comfortably past the 3:1 non-text bar it is held to (D-057).
   */
  tone?: 'movement' | 'brand';
}) {
  // Two points is the minimum that makes a line. Anything less renders nothing rather
  // than a misleading flat baseline.
  if (points.length < 2) return null;

  const width = 100;
  const height = 28;

  const numbers = points.map(Number);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  // A flat series would divide by zero; draw it down the middle instead.
  const span = max - min || 1;

  const path = numbers
    .map((value, index) => {
      const x = (index / (numbers.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn('h-8 w-full', className)}
    >
      <path
        d={path}
        fill="none"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={
          tone === 'brand' ? 'stroke-rose' : rising ? 'stroke-up' : 'stroke-down'
        }
      />
    </svg>
  );
}
