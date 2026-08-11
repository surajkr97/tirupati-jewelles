/**
 * The 404 page.
 * Created by the UI redesign, Stage 2 (audit C-2).
 *
 * ── Why there was none ──
 *
 * The application shipped nine phases with no `not-found.tsx` anywhere, so every 404 was
 * Next's unstyled default: black Helvetica on white, no navigation, no way back. That page
 * was reachable from more places than it looks — a mistyped product slug, a stale WhatsApp
 * link, an expired share URL, and `proxy.ts:98`, which deliberately serves a 404 to anyone
 * probing `/admin` without a session.
 *
 * ── Why it deliberately does NOT live under /admin ──
 *
 * There is no `app/admin/not-found.tsx`, and adding one would be a disclosure bug. §3.6's
 * rule is "return 404, not 403, on admin routes for non-admins — do not confirm the route
 * exists", and `requireAdminPage()` calls `notFound()` to enforce it. A 404 rendered from
 * inside the admin segment would answer with admin branding and a "Back to dashboard"
 * button, which confirms the route exists just as loudly as a 403 would. Every admin 404
 * falls through to this page on purpose.
 *
 * ── Rendering context ──
 *
 * A root `not-found.tsx` renders inside `app/layout.tsx` only — the `(app)` group's header,
 * footer and bottom nav do not apply. That is correct rather than unfortunate: a 404 from
 * `/admin` should not paint the storefront's shell around itself. It does mean this page
 * carries its own links, which is why they are explicit below.
 */
import Link from 'next/link';
import { Compass } from 'lucide-react';

import { Container } from '@/components/shell';
import { buttonClasses, EmptyState } from '@/components/ui';

export const metadata = {
  title: 'Page not found — Tirupati Jewelles',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-cream">
      <Container className="grid place-items-center">
        <EmptyState
          // The document's only heading — see EmptyStateProps.titleAs.
          titleAs="h1"
          icon={<Compass className="size-8" aria-hidden="true" />}
          title="We couldn't find that page"
          description="The link may be old, or the piece may no longer be listed. These still work."
          action={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Link href="/" className={buttonClasses({ variant: 'primary' })}>
                Back to home
              </Link>
              <Link href="/collections" className={buttonClasses({ variant: 'outline' })}>
                Browse the collection
              </Link>
              {/* Rates is the reason most people open this site at all (§4.5), so it is the
                third door rather than a generic "search". */}
              <Link href="/rates" className={buttonClasses({ variant: 'ghost' })}>
                Today&rsquo;s rates
              </Link>
            </div>
          }
        />
      </Container>
    </main>
  );
}
