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
        'bg-cream/85 backdrop-blur-md',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {/* The border lives on the list, not the nav, so the nav's own height is exactly
          --spacing-bottom-nav plus the safe-area inset — which is what the spacer
          reserves. border-box means the 1px border is inside the 64px. */}
      <ul className="flex h-bottom-nav items-stretch justify-around border-t border-line">
        {BOTTOM_NAV.map(({ href, label, icon: Icon }) => {
          const active = isActiveHref(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // h-full fills the 64px row — comfortably above the 44px minimum.
                  'flex h-full flex-col items-center justify-center gap-1 px-1',
                  'text-small font-medium transition-colors duration-fast ease-standard',
                  active ? 'text-rose-deep' : 'text-muted',
                )}
              >
                <Icon
                  className="size-6"
                  aria-hidden="true"
                  strokeWidth={active ? 2.2 : 1.8}
                />
                {label}
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
