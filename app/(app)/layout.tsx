/**
 * Storefront shell.
 * Created by Phase 2 (specs/02-design-system.md §2.3).
 *
 * Wraps only the `(app)` group — /admin gets its own shell in Phase 7, and the auth screens
 * in Phase 3 are full-screen on mobile with no bottom nav.
 */
import { AppHeader, BottomNav, BottomNavSpacer, Footer } from '@/components/shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="flex-1">{children}</main>
      <Footer />
      {/* Reserves the fixed nav's height so the footer is never hidden behind it. */}
      <BottomNavSpacer />
      <BottomNav />
    </div>
  );
}
