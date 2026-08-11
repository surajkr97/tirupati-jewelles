/**
 * Sticky bottom bars, and the space they reserve.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6 DESIGN), shared with Phase 5's total bar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  The reserved space is MEASURED, not guessed.
 *
 *  Both §5 DESIGN ("sticky bar never covers the last item's inputs") and §6 DESIGN
 *  ("sticky CTA does not obscure content") need the document to end far enough above a
 *  `fixed` bar. Two earlier attempts got this wrong in ways worth recording:
 *
 *    1. A spacer rendered inside the page. It sits before the layout's `<Footer />` in
 *       document order, so it pushes the footer down instead of clearing it — the footer
 *       stayed under the bar.
 *    2. A hardcoded 84px on the layout. The bar is 164px tall at 375px once its
 *       bottom-nav padding and safe-area inset are counted, so the footer was still
 *       15.5px short. A magic number that is wrong is how this bug happened twice.
 *
 *  So the bar measures itself and publishes the height as a CSS variable; the layout pads
 *  by exactly that. It self-corrects when the bar wraps, when the nav height changes, and
 *  on a device with a home indicator.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils/cn';

/** Read by the `(app)` layout as `pb-[var(--sticky-bar-height,0px)]`. */
export const STICKY_BAR_HEIGHT_VAR = '--sticky-bar-height';

/**
 * A fixed bottom bar that reserves its own height at the end of the document.
 *
 * `data-sticky-bar` is what the layout's `:has()` selector keys on; the variable carries
 * the exact number.
 */
export function StickyBar({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const publish = () => {
      document.documentElement.style.setProperty(
        STICKY_BAR_HEIGHT_VAR,
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
    };

    publish();

    /**
     * Re-measure on rotation, on a font-size change, and when the bar's own content
     * rewraps — a total growing from ₹9,999 to ₹1,36,609 can add a line.
     *
     * Guarded because a missing `ResizeObserver` must degrade to "measured once" rather
     * than throw: this component renders inside the page, so an exception here would take
     * the whole route down to protect against a layout nicety. Every browser this ships to
     * has it; the guard is for the ones that do not.
     */
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(element);

    return () => {
      observer?.disconnect();
      // Leaving a stale height set would pad every page that has no bar.
      document.documentElement.style.removeProperty(STICKY_BAR_HEIGHT_VAR);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-sticky-bar=""
      data-testid={testId}
      className={cn(
        /**
         * ── The left edge is a variable, because the admin has a rail ──
         *
         * `inset-x-0` was right while every layout was a single column. Stage 2 gave the
         * admin a fixed 240px rail at `md:`, and this bar — `fixed`, full width, `z-40`
         * against the rail's `z-30` — painted its `bg-cream/90` straight over it. axe caught
         * it before a human did: `text-muted` on the resulting composite of cream-over-wine
         * (#e7e0e0) measures 4.02:1 and fails AA on /admin/bills/new.
         *
         * `--sticky-bar-left` defaults to 0, so the storefront is unchanged. The admin shell
         * sets it to the rail's width at `md:`. Same mechanism as `--sticky-bar-height`
         * above: one variable, set by the layout that knows the geometry.
         */
        'fixed right-0 bottom-0 left-[var(--sticky-bar-left,0px)] z-40',
        /**
         * ── DEBT-033: the band below this bar must not swallow the bottom nav ──
         *
         * The `pb-…` below reserves the nav's height so the bar's CONTENT sits above it.
         * But that padding is still part of this element's box, which is `bottom-0` and
         * `z-40` against the nav's `z-30` — so it painted `bg-cream/90` over the nav and,
         * worse, captured its clicks. Hit-tested with `document.elementFromPoint` at the
         * centre of each nav link: **all five returned the sticky bar**, on `/calculator`
         * and on every product page. The nav showed through dimmed, reading as available
         * while being completely dead.
         *
         * So the outer box is now transparent and click-through, and the chrome —
         * background, blur, top border — moved to the inner element, which stops above the
         * nav. The nav is fully visible and fully tappable; the bar looks unchanged.
         *
         * `pointer-events-none` here with `pointer-events-auto` on the child is the whole
         * mechanism. Do not move the background back out here.
         */
        'pointer-events-none',
        // Clears the mobile bottom nav; on desktop there is none, only the safe area.
        'pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] md:pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      {/*
        The visible bar. Full-bleed so the background reaches both edges, with the content
        constrained inside it — the background cannot live on the `max-w-[1200px]` row or it
        would render as a centred band on desktop.

        The measured height still comes from the OUTER element, so it continues to include
        the reserved nav band and the layout's footer clearance is unaffected.
      */}
      {/*
        Opaque, for the same reason `BottomNav` is (Stage 4E).

        `cream/90` over the wine footer composites to #E7E0E0, where `muted` measures
        4.02:1 — below AA, on the bar carrying the total. It only appeared at `tablet-768`,
        where the bottom nav is hidden and this bar is the thing sitting over the footer.
      */}
      <div className="pointer-events-auto border-t border-line bg-cream">
        <div className="mx-auto flex w-full max-w-[1200px] items-center gap-4 px-[20px] py-4 md:px-[40px]">
          {children}
        </div>
      </div>
    </div>
  );
}
