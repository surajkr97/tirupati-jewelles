/**
 * Sticky total bar.
 * Created by Phase 5 (specs/05-calculator.md §5.4).
 *
 * §5 DESIGN: "Total is the most visually prominent element on the screen."
 *
 * Built on the shared `StickyBar`, which measures itself so the layout can reserve exactly
 * the right space at the end of the document. Phase 6 found that the page-level spacer
 * this used to render did not actually clear the footer — see components/shell/sticky-bar.tsx.
 */
'use client';

import { ChevronUp, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { StickyBar } from '@/components/shell/sticky-bar';
import { Button } from '@/components/ui';
import { formatINR } from '@/lib/money';

export interface TotalBarProps {
  grandTotal: bigint;
  itemCount: number;
  sharing?: boolean;
  onExpand: () => void;
  onShare: () => void;
}

export function TotalBar({
  grandTotal,
  itemCount,
  sharing = false,
  onExpand,
  onShare,
}: TotalBarProps) {
  const displayed = useCountUp(grandTotal);

  return (
    <StickyBar testId="total-bar">
      <button
        type="button"
        onClick={onExpand}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        aria-label="Show the full breakdown"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-small text-muted">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
          <span
            className="block truncate text-h1 font-semibold text-ink num"
            data-testid="grand-total"
          >
            {formatINR(displayed)}
          </span>
        </span>
        <ChevronUp className="size-icon shrink-0 text-muted" aria-hidden="true" />
      </button>

      <Button
        variant="accent"
        size="md"
        onClick={onShare}
        loading={sharing}
        className="shrink-0"
      >
        <Share2 className="size-4" aria-hidden="true" />
        Share
      </Button>
    </StickyBar>
  );
}

/**
 * Count the displayed total up to its new value over ~250ms.
 *
 * §5.4: "Under 300ms — long count-ups read as slow, not delightful."
 *
 * Respects `prefers-reduced-motion` in JS, not only in CSS. Phase 2 left a note that the
 * global CSS override kills animation but not a timer, and this is a timer — the same
 * lesson the Phase 4 ticker had to learn.
 */
const COUNT_UP_MS = 250;

function useCountUp(target: bigint): bigint {
  const [displayed, setDisplayed] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const from = fromRef.current;
    if (reduced || from === target) {
      fromRef.current = target;
      setDisplayed(target);
      return;
    }

    const start = performance.now();
    const delta = target - from;

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_UP_MS);
      // Ease-out: most of the movement happens early, so the number reads as settling
      // rather than crawling.
      const eased = 1 - (1 - progress) ** 3;

      // Interpolate in bigint. Scaling by 10,000 keeps a large total from collapsing to
      // integer steps at the start of the animation.
      const scaled = (delta * BigInt(Math.round(eased * 10_000))) / 10_000n;
      setDisplayed(from + scaled);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
        setDisplayed(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      // Land on the truth if the animation is interrupted — a total frozen mid-count is
      // a wrong price on screen.
      fromRef.current = target;
    };
  }, [target]);

  return displayed;
}
