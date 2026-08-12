/**
 * BottomNav — mobile only, 5 items.
 * Created by Phase 2 (specs/02-design-system.md §2.3).
 *
 * The safe-area padding is not cosmetic: without
 * `padding-bottom: env(safe-area-inset-bottom)` the nav sits underneath the iPhone home
 * indicator and the last row of targets becomes unreliable. Acceptance criterion 5 checks
 * this on a real device or simulator.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BOTTOM_NAV, isActiveHref } from '@/lib/navigation';
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
         * arbitrary. Stage 4E made the footer wine, and axe caught the consequence
         * immediately: `cream/85` over wine composites to #DED4D5, where the inactive
         * labels (`muted`) measure **3.61:1** and the active one (`roseDeep`) 4.16 — both
         * below AA, on the application's primary navigation.
         *
         * Raising the alpha to 0.97 clears it at 4.63, but by then the surface is visually
         * opaque and the blur behind it renders nothing — paying a compositing layer for an
         * effect nobody can see, and keeping only 0.13 of headroom. Opaque gives 4.91 and
         * does not depend on what is beneath.
         */
        'bg-cream',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {/* The border lives on the list, not the nav, so the nav's own height is exactly
          --spacing-bottom-nav plus the safe-area inset — which is what the spacer
          reserves. border-box means the 1px border is inside the bar. */}
      <ul className="flex h-bottom-nav items-stretch justify-around border-t border-line">
        {BOTTOM_NAV.map(({ href, label, shortLabel, icon: Icon }) => {
          const active = isActiveHref(pathname, href);
          // `min-w-0` so `flex-1` can actually equalise the cells: without it the flex floor
          // is min-content and the longest label sets the width of every cell.
          return (
            <li key={href} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  /**
                   * `relative` for the indicator, `h-full` for the target.
                   *
                   * §3 and §12 both draw the same distinction: the TOUCH TARGET stays the
                   * full row, comfortably past 44px, while the visual weight comes down.
                   * Stage 6 took the icon from 24px to 18px and the label from 14px to
                   * 11px, which is what let the bar itself go from 64px to 56px without
                   * anything getting harder to hit.
                   */
                  /**
                   * No horizontal padding, measured rather than chosen.
                   *
                   * Five cells across 320px is 64px each. `px-1` spent 8px of that on
                   * whitespace the eye cannot see — the icon and label are centred anyway —
                   * and it was the difference between "Account" (62px at 11px) fitting and
                   * being truncated to "Accoun…". The touch target is the whole cell either
                   * way, which is the §3 distinction again.
                   */
                  'relative flex h-full flex-col items-center justify-center gap-1',
                  'text-caption font-medium transition-colors duration-fast ease-standard',
                  active ? 'text-ink' : 'text-muted',
                )}
              >
                {/*
                  The active state is a rule, not a fill.

                  §11 rules out the bulky pill and §17 wants rose used as an accent rather
                  than a surface — so the indicator is a 2px rose bar on the cell's top
                  edge, the way a tab strip marks its selection. The label going from
                  `muted` to `ink` is the second channel, so the state never rests on
                  colour alone (§23).
                */}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 h-[2px] w-8 rounded-pill bg-rose-deep"
                  />
                )}
                <Icon
                  className="size-icon-sm"
                  aria-hidden="true"
                  strokeWidth={active ? 2 : 1.6}
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
 */
export function BottomNavSpacer() {
  return (
    <div
      aria-hidden="true"
      className="h-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] md:hidden"
    />
  );
}
