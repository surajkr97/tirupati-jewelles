/**
 * Admin bottom navigation.
 * Created by Phase 7 (specs/07-admin-panel.md §7.1).
 *
 * §7.1: "Bottom nav: Dashboard · Rates · Products · Bills · More."
 *
 * The same pattern as the storefront's `BottomNav` rather than a sidebar, for the reason
 * §7 gives: the owner is standing in a shop holding a phone. A desktop admin gets the same
 * bar — it is the layout that works one-handed, and a second responsive layout is a second
 * thing to keep correct.
 */
'use client';

import { Image, LayoutDashboard, Package, ReceiptText, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils/cn';

const ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/rates', label: 'Rates', icon: TrendingUp },
  { href: '/admin/products', label: 'Products', icon: Package },
  { href: '/admin/bills', label: 'Bills', icon: ReceiptText },
  { href: '/admin/media', label: 'More', icon: Image },
] as const;

function isActive(pathname: string, href: string): boolean {
  // `/admin` would otherwise light up on every child route.
  if (href === '/admin') return pathname === '/admin';
  return pathname.startsWith(href);
}

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30',
        'bg-cream/90 backdrop-blur-md',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="flex h-bottom-nav items-stretch justify-around border-t border-line">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // Fills the 64px row — comfortably past the 44px minimum.
                  'flex h-full flex-col items-center justify-center gap-1 px-1',
                  'text-small font-medium transition-colors duration-fast ease-standard',
                  active ? 'text-taupe-deep' : 'text-muted',
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

/** Reserves the fixed nav's height so the last card is never hidden behind it. */
export function AdminNavSpacer() {
  return (
    <div
      aria-hidden="true"
      className="h-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))]"
    />
  );
}
