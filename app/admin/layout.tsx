/**
 * Admin shell.
 * Created by Phase 7 (specs/07-admin-panel.md §7.1).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §7.1: "SSR only, `force-dynamic`, `noindex`. Role checked in proxy **and** re-checked in
 *  every handler and page. Non-admins get 404, never 403."
 *
 *  `requireAdminPage()` here calls `notFound()`, so a signed-in customer who guesses the
 *  URL gets the same 404 as a stranger. `proxy.ts` already rewrites `/admin` to a 404 when
 *  there is no session cookie, but it runs at the edge and can only see whether a cookie
 *  *exists* — not whether it is valid or what role it carries. That is precisely why the
 *  check is repeated here, and why every action repeats it again.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §7 design intent: "The admin is a jeweller, not an operator of a CRUD dashboard. They
 * will use this on a phone, standing in a shop, between customers." Same tokens as the
 * storefront, same bottom nav pattern — no dense enterprise chrome.
 */
import Link from 'next/link';

import type { Metadata } from 'next';

import { AdminNav, AdminNavSpacer, AdminSidebar } from '@/components/admin/admin-nav';
import { requireAdminPage } from '@/lib/auth/guard';

/** Per-admin and never cacheable (§7.1, MASTER-SPEC §6). */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin' },
  // §7.1. Belt and braces with `proxy.ts`, which 404s the whole tree for a signed-out
  // visitor — a crawler has no cookie, so it never sees this anyway.
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The boundary. Renders the 404 page for anyone who is not an ADMIN.
  const admin = await requireAdminPage();

  return (
    /**
     * `has-[[data-sticky-bar]]:pb-*` reserves room for a page's fixed bottom bar — the same
     * mechanism the storefront layout uses, and here for the same reason.
     *
     * Added by Phase 8. `/admin/bills/new` is the first admin screen with a `StickyBar`, and
     * without this the bar covered "Add another item" at 375px: the button was visible,
     * enabled and unclickable, because a fixed element sat over it. Playwright found it by
     * timing out on a click that looked fine in a screenshot.
     *
     * The height is published by `StickyBar` from a real measurement — see that file for why
     * a hardcoded value was wrong twice already.
     */
    <div className="min-h-dvh bg-cream">
      {/* Desktop rail. Fixed, so it survives a long bills table. `md:` only. */}
      <AdminSidebar />

      {/*
        The content column reserves the rail's width from the SAME token the rail sets it
        from (`--spacing-admin-rail`), so the two cannot drift apart and let the nav overlap
        the page — the mechanism `--spacing-bottom-nav` already uses for the bottom bar.
      */}
      <div className="flex min-h-dvh flex-col md:pl-admin-rail md:[--sticky-bar-left:var(--spacing-admin-rail)] has-data-sticky-bar:pb-[var(--sticky-bar-height,0px)]">
        {/*
          Compact by design (§12): who you are, and — on a phone, where there is no rail —
          which product you are in. The page title is NOT here; every admin page renders its
          own `h1`, and repeating a generic "Shop admin" above it gave each screen two
          headings, the larger of which said nothing.

          There is no menu trigger here either. The bottom bar carries one, in the half of
          the screen a thumb reaches; a second control opening the same sheet from the
          furthest corner would be redundant rather than convenient.

          Opaque, per D-076 — a translucent header over an admin table has the same
          unpredictable-contrast problem the storefront's chrome had over the wine footer.
        */}
        <header className="sticky top-0 z-20 border-b border-line bg-cream">
          <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-[20px] py-4 md:px-[40px]">
            <Link
              href="/admin"
              className="font-display text-h3 font-medium text-ink md:hidden"
            >
              Tirupati J.
            </Link>
            {/* Holds the row's right edge on desktop, where the rail shows the wordmark. */}
            <span className="hidden md:block" />

            <p
              className="truncate text-small text-muted"
              title={admin.email ?? admin.name ?? undefined}
            >
              {admin.email ?? admin.name}
            </p>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <AdminNavSpacer />
        <AdminNav />
      </div>
    </div>
  );
}
