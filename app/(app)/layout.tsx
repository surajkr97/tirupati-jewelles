/**
 * Storefront shell.
 * Created by Phase 2 (specs/02-design-system.md §2.3).
 *
 * Wraps only the `(app)` group — /admin gets its own shell in Phase 7, and the auth screens
 * in Phase 3 are full-screen on mobile with no bottom nav.
 */
import { AppHeader, BottomNav, BottomNavSpacer, Footer } from '@/components/shell';
import { WhatsAppFab } from '@/components/shell/whatsapp-fab';

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
