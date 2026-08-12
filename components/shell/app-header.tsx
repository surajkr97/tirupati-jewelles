/**
 * AppHeader — the storefront's primary navigation.
 * Created by Phase 2 (specs/02-design-system.md §2.3).
 * Given a desktop navigation and a mobile menu by the UI redesign, Stage 2.
 *
 * ── The defect this fixes (audit C-1) ──
 *
 * Until Stage 2 this header held a wordmark and two icons, and `BottomNav` is `md:hidden`.
 * At 768px and up the application therefore had NO primary navigation at all: the only route
 * to Rates, Calculator or Collections was to scroll to the footer. That was the largest
 * wayfinding defect in the audit and it survived nine phases, because every phase was built
 * and reviewed on a phone, where the bottom nav is present.
 *
 * ── Two treatments, one component (brief §13) ──
 *
 * `overlay` renders the header transparently over a wine hero with cream marks, and
 * solidifies to cream on scroll. Everywhere else it is the cream treatment from the start.
 * The overlay branch carries `.surface-wine`, so the focus ring inverts to cream — the
 * default ink ring is 1.05:1 on wine and a keyboard user would see nothing (D-057).
 *
 * Contrast in the overlay state comes from the wine ground and cream marks (15.51:1), never
 * from reducing text opacity to "blend" — brief §3 forbids it, and it is how a header
 * becomes unreadable over a bright patch of a photograph.
 *
 * `overlay` is NOT enabled anywhere yet. The homepage's hero is still the Phase 4 image
 * frame, and cream marks over an unknown photograph is the contrast failure this comment
 * just described. Stage 4 turns it on with the wine hero. See D-062.
 */
'use client';

import { Menu, MessageCircle, Search, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Container } from '@/components/shell/container';
import { buttonClasses, Sheet } from '@/components/ui';
import { buildGeneralMessage, buildWhatsAppUrl } from '@/lib/catalog/whatsapp';
import { clientEnv } from '@/lib/env';
import { isActiveHref, STOREFRONT_PRIMARY, STOREFRONT_SECONDARY } from '@/lib/navigation';
import { cn } from '@/lib/utils/cn';

/**
 * Routes whose first section is a wine hero, so the header can start transparent over it.
 *
 * The header is a client component that already reads the pathname; the `(app)` layout is a
 * server component wrapping every storefront route and cannot know which one is rendering.
 * Putting the list here keeps the decision in the one place that has the information.
 */
const OVERLAY_ROUTES = new Set(['/']);

export interface AppHeaderProps {
  /**
   * Force the transparent-over-hero treatment. Normally inferred from the route.
   *
   * Stage 2 built this and D-062 deliberately left it switched off: the homepage's hero was
   * still a photograph from a `MediaSlot`, and cream marks over an arbitrary image is a coin
   * flip on contrast rather than a treatment. Stage 4A gives `/` a wine hero, so the ground
   * is now a known colour at 15.51:1 and it is switched on.
   */
  overlay?: boolean;
  /** The shop's WhatsApp number, read once by the layout (DEBT-050). */
  ownerWhatsApp: string;
}

export function AppHeader({ overlay, ownerWhatsApp }: AppHeaderProps) {
  const pathname = usePathname();
  const overlayHero = overlay ?? OVERLAY_ROUTES.has(pathname);
  const [scrolled, setScrolled] = useState(false);
  /**
   * The menu is DERIVED from the route it was opened on, not closed by an effect.
   *
   * `useEffect(() => setMenuOpen(false), [pathname])` is the obvious way to close a menu on
   * navigation and the React Compiler rejects it — a synchronous setState in an effect
   * cascades an extra render. Storing the pathname the menu was opened at makes closing a
   * consequence of the route changing rather than a reaction to it: the moment `pathname`
   * differs, `menuOpen` is already false on the first render of the new page.
   */
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null);
  const menuOpen = menuOpenedAt === pathname;
  const setMenuOpen = (open: boolean) => setMenuOpenedAt(open ? pathname : null);

  useEffect(() => {
    if (!overlayHero) return;

    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll(); // a refresh can restore mid-page scroll before any event fires

    // `passive` keeps scrolling off the main-thread critical path — this listener runs on
    // every frame of a scroll and must never be able to block it.
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overlayHero]);

  /**
   * `onWine` is now "over the hero photograph".
   *
   * The name is Stage 4's and the ground changed under it in Stage 6 — the hero is a
   * photograph with a measured scrim rather than a wine field (§5). The branch still means
   * the same thing: the header is transparent over a dark image, so its marks invert. Kept
   * as one flag rather than renamed through the file, and `.surface-wine` still does the one
   * job it is here for, which is inverting the focus ring on a dark ground.
   */
  const onWine = overlayHero && !scrolled;

  const whatsAppHref = buildWhatsAppUrl(
    ownerWhatsApp,
    buildGeneralMessage(clientEnv.NEXT_PUBLIC_SITE_URL),
  );

  /** Icon-only controls: 44px, labelled, legible on whichever ground they sit on. */
  const iconButton = cn(
    'grid size-tap place-items-center rounded-pill',
    'transition-colors duration-fast ease-standard',
    onWine ? 'text-white hover:bg-white/15' : 'text-ink hover:bg-rose-tint',
  );

  return (
    <header
      className={cn(
        'sticky top-0 z-30 transition-colors duration-base ease-standard',
        onWine
          ? 'surface-wine bg-transparent'
          : 'border-b border-line bg-cream/90 backdrop-blur-md',
      )}
    >
      <Container>
        <div className="flex h-header items-center justify-between gap-4 md:h-header-lg">
          {/* The wordmark IS the home link, which is why STOREFRONT_PRIMARY omits Home. */}
          <Link
            href="/"
            /* Starts with the visible text, so WCAG 2.5.3 (Label in Name) holds — voice
               control users say what they see. The full legal name lives in the footer,
               the metadata and every document (§15). */
            aria-label="Tirupati J. — home"
            aria-current={pathname === '/' ? 'page' : undefined}
            className={cn(
              'flex h-tap shrink-0 items-center font-display text-h3 font-medium',
              'tracking-[-0.01em]',
              onWine ? 'text-white' : 'text-ink',
            )}
          >
            {/* §13 — the website's visual brand is "Tirupati J." */}
            Tirupati J.
          </Link>

          {/* ── Desktop navigation. The whole point of Stage 2. ── */}
          {/* Not "Primary" — `BottomNav` has carried that landmark name since Phase 2, and
              two navs sharing a label is ambiguous to a screen reader moving by landmark
              even though only one is ever displayed. */}
          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex items-center gap-2">
              {STOREFRONT_PRIMARY.map(({ href, label }) => {
                const active = isActiveHref(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-tap items-center rounded-pill px-4 text-small font-medium',
                        'transition-colors duration-fast ease-standard',
                        onWine
                          ? cn('text-white hover:bg-white/15', active && 'bg-white/15')
                          : cn(
                              'hover:bg-rose-tint',
                              // roseDeep, not rose: 14px text needs the full 4.5:1 (D-057).
                              active ? 'bg-rose-tint text-rose-deep' : 'text-ink',
                            ),
                      )}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-1 md:gap-2">
            <Link href="/search" aria-label="Search" className={iconButton}>
              <Search className="size-icon-sm" aria-hidden="true" />
            </Link>

            <Link href="/account" aria-label="Account" className={iconButton}>
              <User className="size-icon-sm" aria-hidden="true" />
            </Link>

            {/* The commercial action. There is no checkout (MASTER-SPEC §1), so this is the
                header's only button. Desktop only: on a phone the WhatsApp FAB already does
                this job, and two of them is a choice nobody should have to make. */}
            <a
              href={whatsAppHref}
              target="_blank"
              rel="noopener noreferrer"
              /**
               * Order matters here, and getting it wrong was a real 320px overflow.
               *
               * `buttonClasses` includes `inline-flex` in its base. Written as
               * `cn('hidden md:inline-flex', buttonClasses(...))` the base class comes LAST,
               * so tailwind-merge resolved the `display` conflict in its favour and the
               * button rendered at every width — pushing the header's control cluster to
               * 260px and the document to a 370px scrollWidth inside a 320px viewport.
               *
               * It survived review because it fits at 375px with 5px to spare, which is the
               * narrowest viewport the suite measured before Stage 2 added 320.
               * `lib/utils/cn.ts` documents this exact hazard.
               */
              className={cn(
                buttonClasses({ variant: onWine ? 'onWine' : 'accent', size: 'sm' }),
                'ml-2 hidden md:inline-flex',
              )}
            >
              <MessageCircle className="size-4" aria-hidden="true" />
              Enquire
            </a>

            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className={cn(iconButton, 'md:hidden')}
            >
              <Menu className="size-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </Container>

      {/* Reuses the Sheet primitive — it already provides the focus trap, Esc-to-close and
          scroll lock §2.2 requires. A second drawer would be a second focus trap to keep
          correct, and focus traps are where hand-rolled dialogs go wrong. */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Menu">
        <nav aria-label="All pages" className="flex flex-col gap-1 pb-4">
          {[...STOREFRONT_PRIMARY, ...STOREFRONT_SECONDARY].map(
            ({ href, label, icon: Icon }) => {
              const active = isActiveHref(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-control items-center gap-4 rounded-field px-4',
                    'text-body font-medium transition-colors duration-fast ease-standard',
                    active ? 'bg-rose-tint text-rose-deep' : 'text-ink hover:bg-rose-tint',
                  )}
                >
                  <Icon className="size-icon shrink-0" aria-hidden="true" />
                  {label}
                </Link>
              );
            },
          )}

          <a
            href={whatsAppHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('mt-4', buttonClasses({ variant: 'accent', full: true }))}
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            Enquire on WhatsApp
          </a>
        </nav>
      </Sheet>
    </header>
  );
}
