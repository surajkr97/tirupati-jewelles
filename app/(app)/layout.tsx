/**
 * Storefront shell.
 * Created by Phase 2 (specs/02-design-system.md §2.3).
 *
 * Wraps only the `(app)` group — /admin gets its own shell in Phase 7, and the auth screens
 * in Phase 3 are full-screen on mobile with no bottom nav.
 */
import { JsonLd } from '@/components/seo/json-ld';
import { AppHeader, BottomNav, BottomNavSpacer, Footer } from '@/components/shell';
import { WhatsAppFab } from '@/components/shell/whatsapp-fab';
import { db } from '@/lib/db';
import { localBusinessJsonLd } from '@/lib/seo';

/**
 * §9.6's `LocalBusiness` structured data, on the storefront only.
 *
 * On the LAYOUT rather than on the homepage, because the shop is the publisher of every
 * storefront page and a customer can land on any of them from search. It is scoped to the
 * `(app)` group so it never appears in /admin or on the auth screens — those are not
 * public pages and should carry no business markup at all.
 *
 * Read from the §7.9 Settings row so the address and phone are the shop's real ones. Every
 * optional field is omitted when unset (see `localBusinessJsonLd`): publishing an invented
 * address as machine-readable business data is how a wrong pin ends up on a map.
 */
async function shopIdentity() {
  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: { shopName: true, address: true, contactPhone: true },
  });

  return settings ?? { shopName: 'Tirupati Jewelles', address: null, contactPhone: null };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const shop = await shopIdentity();

  return (
    /**
     * `has-[[data-sticky-bar]]:pb-*` reserves room for a page's fixed bottom bar.
     *
     * A page-level spacer cannot do this: it renders inside `{children}`, before the
     * Footer in document order, so it pushes the footer down instead of clearing it.
     *
     * The height is published by `StickyBar` from a real measurement — see that file for
     * why a hardcoded value was wrong twice. `:has()` scopes the padding to pages that
     * actually have a bar, and the `0px` fallback means it costs nothing elsewhere.
     */
    <div className="flex min-h-dvh flex-col has-data-sticky-bar:pb-[var(--sticky-bar-height,0px)]">
      <JsonLd data={localBusinessJsonLd(shop)} />
      <AppHeader />
      <main className="flex-1">{children}</main>
      <Footer />
      {/* Reserves the fixed nav's height so the footer is never hidden behind it. */}
      <BottomNavSpacer />
      <BottomNav />
      {/* §6.3 — site-wide, and hides itself on the product page where the sticky enquiry
          bar already offers a better version of the same action. */}
      <WhatsAppFab />
    </div>
  );
}
