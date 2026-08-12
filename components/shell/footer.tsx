/**
 * Footer — the storefront's closing section.
 * Created by Phase 2 (specs/02-design-system.md §2.3), restyled by Stage 4E (brief §19).
 *
 * ── Light, because the page is ──
 *
 * Stage 4E made this wine, reasoning that "the homepage opens on a wine hero and closes on a
 * wine trust band; a cream footer under that read as the page giving up rather than ending".
 * Stage 6 removed both of those surfaces (§1), so the premise is gone: the hero is a
 * photograph and the trust band is sand. A dark footer under a light page is now the thing
 * that would read as a non-sequitur.
 *
 * `gold` went with it. It measures 6.84:1 on wine and 2.27:1 on cream, so the trust marks
 * use `rose` — this palette's small non-text accent (D-057).
 *
 * ── Real routes only ──
 *
 * `/policies/privacy` and `/policies/terms` were listed here from Phase 2 and **did not
 * exist until §9.6 wrote them** — the footer of every storefront page carried two links to a
 * 404 for three phases. Every href here is now resolved against the real `app/` tree by
 * `lib/navigation.test.ts`, and `e2e/seo.spec.ts` fetches each one.
 *
 * There is deliberately no About or Contact: those routes do not exist, and D-060 records
 * the decision not to invent copy for them. The shop's real address and phone reach the page
 * through the `LocalBusiness` structured data in the layout, from the §7.9 Settings row.
 */
import { BadgeCheck, MessageCircle, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { Container } from '@/components/shell/container';
import { buttonClasses } from '@/components/ui';

const SHOP_LINKS = [
  { href: '/collections', label: 'Collections' },
  { href: '/rates', label: "Today's rates" },
  { href: '/calculator', label: 'Price calculator' },
  { href: '/search', label: 'Search' },
] as const;

const POLICY_LINKS = [
  { href: '/policies/privacy', label: 'Privacy' },
  { href: '/policies/terms', label: 'Terms' },
  { href: '/policies/refunds', label: 'Refunds' },
  { href: '/policies/shipping', label: 'Shipping' },
  { href: '/policies/exchange', label: 'Buyback & exchange' },
] as const;

/**
 * The trust strip is not decoration. Phase 6 §6.2 notes Indian buyers actively check
 * hallmarking and that missing it costs conversions, so it appears site-wide.
 *
 * Two items, not three: the homepage's `TrustBand` now carries the full set, and repeating
 * four claims a screen apart makes both read as filler. These are the two that belong on
 * every page, including the ones the trust band never appears on.
 */
const TRUST = [
  { icon: ShieldCheck, label: 'BIS hallmarked' },
  { icon: BadgeCheck, label: 'Certified purity' },
] as const;

export function Footer({ ownerWhatsApp }: { ownerWhatsApp: string }) {
  return (
    /**
     * Stage 6: was `surface-wine bg-wine text-cream`.
     *
     * Stage 4E made this wine because "the homepage opens on a wine hero and closes on a
     * wine trust band; a cream footer under that read as the page giving up". Both of those
     * premises are now false — the hero is a photograph and the trust band is sand — so the
     * argument for a dark footer went with them. §20 asks for a natural ending to a light
     * page, and the default ink focus ring is correct again on a light ground.
     */
    <footer className="mt-16 border-t border-line bg-sand text-ink">
      <Container>
        <div className="grid gap-12 py-16 md:grid-cols-[1.5fr_1fr_1fr] md:gap-8">
          <div className="flex flex-col gap-6">
            <span className="font-display text-h2 font-medium tracking-[-0.01em]">
              Tirupati J.
            </span>
            <p className="max-w-2xs text-body text-muted">
              Hallmark-certified gold and silver jewellery. Rates updated daily; final
              price confirmed in store.
            </p>
            <a
              href={`https://wa.me/${ownerWhatsApp}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: 'outline', className: 'w-fit' })}
            >
              <MessageCircle className="size-4" aria-hidden="true" />
              Chat on WhatsApp
            </a>
          </div>

          <FooterNav label="Shop" links={SHOP_LINKS} />
          <FooterNav label="Policies" links={POLICY_LINKS} />
        </div>

        <div className="flex flex-col gap-6 border-t border-line py-8 md:flex-row md:items-center md:justify-between">
          <ul className="flex flex-wrap gap-6">
            {TRUST.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-small text-muted">
                {/* Gold measures 2.27:1 on a light ground (D-057) — rose is this palette's
                    small non-text mark. */}
                <Icon className="size-4 text-rose" aria-hidden="true" strokeWidth={1.5} />
                {label}
              </li>
            ))}
          </ul>

          {/* The LEGAL name, unchanged — §15 keeps business identity accurate. */}
          <p className="text-small text-muted">
            © <span className="num">{new Date().getFullYear()}</span> Tirupati Jewelles.
            All rights reserved.
          </p>
        </div>
      </Container>
    </footer>
  );
}

function FooterNav({
  label,
  links,
}: {
  label: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-col gap-2">
      <h2 className="mb-2 text-small font-semibold tracking-[0.08em] text-muted uppercase">
        {label}
      </h2>
      {links.map(({ href, label: text }) => (
        <Link
          key={href}
          href={href}
          className="flex h-tap items-center text-body text-muted transition-colors duration-fast ease-standard hover:text-ink"
        >
          {text}
        </Link>
      ))}
    </nav>
  );
}
