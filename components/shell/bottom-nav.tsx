/**
 * BottomNav — mobile only, 5 items.
 * Created by Phase 2 (specs/02-design-system.md §2.3), redesigned by Stage 6 (§11).
 *
 * The safe-area padding is not cosmetic: without
 * `padding-bottom: env(safe-area-inset-bottom)` the nav sits underneath the iPhone home
 * indicator and the last row of targets becomes unreliable. Acceptance criterion 5 checks
 * this on a real device or simulator.
 *
 * ── The shape ──
 *
 * A full-width bar anchored to the bottom edge: the active destination coloured — icon and
 * label together — with a short rule on the bar's top edge above it.
 *
 * Two earlier Stage 6 passes got this wrong in opposite directions. The first shrank the
 * stock tab bar and left it recognisably the stock tab bar. The second detached it into a
 * floating rounded card, which was distinctive but wrong for a navigation surface: it read as
 * a widget resting on the page rather than as the edge of the application, and shrinking the
 * icons to 18px to make the inset arithmetic work left the whole thing thin.
 *
 * ── The active state is the colour, not a container ──
 *
 * Marking the cell — a tinted circle behind the glyph, or only the label changing weight —
 * never made the ICON look selected. Colouring the icon and the label together is what reads
 * as "you are here"; the rule on the top edge is the second channel, so the state never rests
 * on colour alone (§23).
 *
 * ── The arithmetic, because it is the whole design ──
 *
 * ── The sizes, arrived at by overshooting twice ──
 *
 * 19px glyph, 11px label, 56px bar — and several passes of that were spent tuning a number
 * that was not reaching the page at all.
 *
 * `cn('text-caption', …, 'text-muted')` was DELETING the size: tailwind-merge cannot tell a
 * custom `text-*` size from a `text-*` colour, so it put both in one group and kept the last.
 * Every label rendered at the inherited 16px while the token said 12, then 10, then 9, and
 * each reduction changed nothing visible. Phase 9 §9.7 had already found this exact bug and
 * left `TEXT_SIZES` in `lib/utils/cn.ts` to prevent it; Stage 6 added `--text-caption` and
 * did not register it there. The lesson is the one this file keeps relearning: measure the
 * rendered element, because a class that reads as applied may not be.
 *
 * With the size actually applied: 19 + 2 + 14 = 35px of content in a 55px cell, leaving
 * ~10px of air above and below. The 2px gap is off the §3 scale (whose smallest step is 4px)
 * for the same reason the indicator rule is: this is optical spacing inside one mark, between
 * a glyph and its own label, not layout spacing between components.
 *
 * At 320px: 320 − 8 (inner padding) = 312 ÷ 5 = 62.4px per cell. "Account" needs ~44px at
 * 11px and fits, which is why it no longer carries a `shortLabel`. "Calculator" needs ~60px
 * — inside the cell but touching both edges, so it keeps "Price".
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BOTTOM_NAV, isActiveBottomNav } from '@/lib/navigation';
import { cn } from '@/lib/utils/cn';

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 md:hidden',
        /**
         * Opaque, not `bg-cream/85 backdrop-blur-md`.
         *
         * A translucent bar cannot promise contrast, because what scrolls under it is
         * arbitrary. Stage 4E made the footer wine and axe caught the consequence
         * immediately: `cream/85` over wine composited to #DED4D5, where the inactive labels
         * measured 3.61:1 — below AA, on the application's primary navigation.
         *
         * White rather than cream since Stage 6: the page itself is cream, so the bar now
         * separates by its own surface and needs only a hairline above it.
         */
        'bg-white',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {/* The border lives on the LIST, not the nav, so the nav's own height is exactly
          --spacing-bottom-nav plus the safe-area inset — which is what the spacer reserves.
          `border-box` keeps the 1px inside the 56px. Phase 2 put it here for this reason and
          a Stage 6 draft moved it to the nav, which made the bar 69px against a 68px
          reservation and slid the footer a pixel underneath it. */}
      <ul className="flex h-bottom-nav items-stretch border-t border-line px-1">
        {BOTTOM_NAV.map((item) => {
          const { href, label, shortLabel, icon: Icon } = item;
          const active = isActiveBottomNav(pathname, item);
          // `min-w-0` so `flex-1` can equalise the cells: without it the flex floor is
          // min-content and the longest label sets the width of every cell.
          return (
            <li key={href} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // The whole cell is the target — 56px tall, well past the 44px floor.
                  // Centred in the cell, with the glyph and its label set tight together so
                  // they read as one mark rather than as two stacked elements.
                  'relative flex h-full flex-col items-center justify-center gap-[2px]',
                  'text-caption font-medium transition-colors duration-fast ease-standard',
                  // `roseDeep`, not `rose`: 12px is body-size text and needs the full 4.5:1,
                  // which plain rose does not clear on white (D-057).
                  active ? 'text-rose-deep' : 'text-muted',
                )}
              >
                {/*
                  The tab-strip rule, on the bar's own top edge.

                  32px wide, and that is a correction of a correction.

                  Scaled off the reference the rule runs about a third of its cell, which
                  is 24px here — and at 24px nobody could see it. The reference's cells are
                  85px wide; ours are 62px, so a third of the cell is simply too little bar
                  to register. Proportion lost to legibility.

                  3px rather than the §3 scale's 4px: this is a hairline rule, not spacing,
                  and the scale's own note says dimensions that are not "spacing in the
                  design sense" get their own figure.
                */}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 h-[3px] w-8 rounded-pill bg-rose-deep"
                  />
                )}
                <Icon
                  className="size-icon-nav"
                  aria-hidden="true"
                  strokeWidth={active ? 2.2 : 1.7}
                />
                <span className="max-w-full truncate">{shortLabel ?? label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Spacer that reserves the nav's height in normal flow.
 *
 * The nav is `fixed`, so without this the last element of every page hides behind it.
 * Phase 5 §5.4 has the same problem with its sticky total bar and stacks on top of this.
 *
 * `--spacing-bottom-nav` is the bar's full height, so the spacer and `StickyBar` both clear
 * it from one number.
 */
export function BottomNavSpacer() {
  return (
    <div
      aria-hidden="true"
      className="h-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] md:hidden"
    />
  );
}
