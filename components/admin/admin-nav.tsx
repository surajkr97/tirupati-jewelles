/**
 * Admin navigation — a rail on desktop, a bottom bar plus a sheet on a phone.
 * Created by Phase 7 (specs/07-admin-panel.md §7.1), made responsive by Stage 2 (D-059).
 *
 * ── What §7.1 got right, and what it cost ──
 *
 * §7.1 chose a bottom nav on every viewport, and argued for it: "the owner is standing in a
 * shop holding a phone… a second responsive layout is a second thing to keep correct." That
 * argument is sound and the phone layout below is unchanged because of it.
 *
 * What it did not price is that a bottom bar has five slots and the admin has eight
 * destinations. Settings and Audit fell out of the navigation entirely — reachable only by
 * first going back to the dashboard and finding a card — and there was no route back to the
 * storefront at all (audit C-5, C-6). A desktop rail has room for all of them.
 *
 * ── The phone keeps its bottom bar, and "More" is now a real menu ──
 *
 * The fifth slot used to be a direct link to /admin/media labelled "More", which is a label
 * that lies about where it goes. It now opens a sheet holding every secondary destination
 * and "Back to site", which is strictly more than the dashboard card it replaces — the
 * condition Stage 2 §6 set for changing it.
 */
'use client';

import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { Sheet } from '@/components/ui';
import {
  ADMIN_ALL,
  ADMIN_PRIMARY,
  ADMIN_SECONDARY,
  BACK_TO_SITE,
  isActiveHref,
} from '@/lib/navigation';
import { cn } from '@/lib/utils/cn';

/** True when the current route lives behind the "More" sheet rather than in the bar. */
function inSecondary(pathname: string): boolean {
  return ADMIN_SECONDARY.some((item) => isActiveHref(pathname, item.href));
}

/**
 * Desktop rail. `hidden md:flex` — the phone never sees it.
 *
 * Fixed rather than sticky so it survives a long bills table without the nav scrolling away,
 * and its width comes from `--spacing-admin-rail`, which the layout also uses to reserve the
 * content column. One token, so the two cannot disagree.
 */
export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin"
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden w-admin-rail flex-col md:flex',
        'surface-wine bg-wine',
      )}
    >
      <Link
        href="/admin"
        className="flex h-header-lg shrink-0 items-center px-6 font-display text-h3 font-medium text-cream"
      >
        Tirupati
      </Link>

      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-4">
        {ADMIN_ALL.map(({ href, label, icon: Icon, description }) => {
          const active = isActiveHref(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-tap flex-col justify-center rounded-field px-4 py-2',
                  'transition-colors duration-fast ease-standard',
                  // Cream on wine is 15.51:1; the muted line below is cream at 70%, 7.99:1.
                  // Selection is a filled block, not a colour swap, so it does not depend on
                  // hue alone (WCAG 1.4.1).
                  active ? 'bg-cream text-wine' : 'text-cream hover:bg-cream/15',
                )}
              >
                <span className="flex items-center gap-4 text-small font-medium">
                  <Icon className="size-icon shrink-0" aria-hidden="true" />
                  {label}
                </span>
                {description && (
                  <span
                    className={cn(
                      'pl-8 text-small',
                      active ? 'text-wine-soft' : 'text-cream/70',
                    )}
                  >
                    {description}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Audit C-6: there was no way back to the shop from here. */}
      <div className="shrink-0 border-t border-cream/15 p-4">
        <Link
          href={BACK_TO_SITE.href}
          className="flex h-tap items-center gap-4 rounded-field px-4 text-small font-medium text-cream transition-colors duration-fast ease-standard hover:bg-cream/15"
        >
          <BACK_TO_SITE.icon className="size-icon shrink-0" aria-hidden="true" />
          {BACK_TO_SITE.label}
        </Link>
      </div>
    </nav>
  );
}

export function AdminNav() {
  const pathname = usePathname();
  /**
   * Derived from the route it was opened on — see the same pattern in `app-header.tsx`.
   * Navigating from inside the sheet closes it because `pathname` changed, not because an
   * effect noticed afterwards.
   */
  const [moreOpenedAt, setMoreOpenedAt] = useState<string | null>(null);
  const moreOpen = moreOpenedAt === pathname;
  const setMoreOpen = (open: boolean) => setMoreOpenedAt(open ? pathname : null);

  const moreActive = inSecondary(pathname);

  return (
    <>
      <nav
        aria-label="Admin"
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 md:hidden',
          'bg-cream/90 backdrop-blur-md',
          'pb-[env(safe-area-inset-bottom)]',
        )}
      >
        <ul className="flex h-bottom-nav items-stretch justify-around border-t border-line">
          {ADMIN_PRIMARY.map(({ href, label, icon: Icon }) => {
            const active = isActiveHref(pathname, href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    // Fills the 64px row — comfortably past the 44px minimum.
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

          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-label="More admin pages"
              className={cn(
                'flex h-full w-full flex-col items-center justify-center gap-1 px-1',
                'text-small font-medium transition-colors duration-fast ease-standard',
                moreActive ? 'text-rose-deep' : 'text-muted',
              )}
            >
              <MoreHorizontal
                className="size-6"
                aria-hidden="true"
                strokeWidth={moreActive ? 2.2 : 1.8}
              />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="More">
        <nav aria-label="Secondary admin pages" className="flex flex-col gap-1 pb-4">
          {ADMIN_SECONDARY.map(({ href, label, icon: Icon, description }) => {
            const active = isActiveHref(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-control items-center gap-4 rounded-field px-4 py-2',
                  'transition-colors duration-fast ease-standard',
                  active ? 'bg-rose-tint text-rose-deep' : 'text-ink hover:bg-rose-tint',
                )}
              >
                <Icon className="size-icon shrink-0" aria-hidden="true" />
                <span className="flex flex-col">
                  <span className="text-body font-medium">{label}</span>
                  {description && (
                    <span className="text-small text-muted">{description}</span>
                  )}
                </span>
              </Link>
            );
          })}

          <Link
            href={BACK_TO_SITE.href}
            className="mt-4 flex h-control items-center gap-4 rounded-field px-4 text-body font-medium text-ink ring-1 ring-line ring-inset transition-colors duration-fast ease-standard hover:bg-rose-tint"
          >
            <BACK_TO_SITE.icon className="size-icon shrink-0" aria-hidden="true" />
            {BACK_TO_SITE.label}
          </Link>
        </nav>
      </Sheet>
    </>
  );
}

/**
 * Reserves the bottom bar's height so the last card is never hidden behind it.
 *
 * `md:hidden` since Stage 2 — on desktop the rail is at the side and nothing is covering the
 * bottom of the page, so reserving 64px there would just be a gap.
 */
export function AdminNavSpacer() {
  return (
    <div
      aria-hidden="true"
      className="h-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] md:hidden"
    />
  );
}
