/**
 * Footer — links, BIS/hallmark trust strip, contact, WhatsApp.
 * Created by Phase 2 (specs/02-design-system.md §2.3).
 *
 * The trust strip is not decoration. Phase 6 §6.2 notes Indian buyers actively check
 * hallmarking and that missing it costs conversions, so it appears site-wide, not only on
 * product pages.
 */
import { BadgeCheck, MessageCircle, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { Container } from '@/components/shell/container';
import { clientEnv } from '@/lib/env';

const SHOP_LINKS = [
  { href: '/collections', label: 'Collections' },
  { href: '/rates', label: "Today's rates" },
  { href: '/calculator', label: 'Price calculator' },
  { href: '/search', label: 'Search' },
] as const;

const POLICY_LINKS = [
  { href: '/policies/privacy', label: 'Privacy' },
  { href: '/policies/terms', label: 'Terms' },
  { href: '/policies/exchange', label: 'Buyback & exchange' },
] as const;

const TRUST = [
  { icon: ShieldCheck, label: 'BIS Hallmarked' },
  { icon: BadgeCheck, label: 'Certified purity' },
  { icon: MessageCircle, label: 'Buyback & exchange' },
] as const;

export function Footer() {
  return (
    <footer className="mt-12 border-t border-line bg-white/50">
      <Container>
        <div className="grid gap-8 py-12 md:grid-cols-3">
          <div className="flex flex-col gap-4">
            <span className="font-semibold tracking-[0.12em] text-ink">TIRUPATI</span>
            <p className="max-w-72 text-small text-muted">
              Hallmark-certified gold and silver jewellery. Rates updated daily; final
              price confirmed in store.
            </p>
            <a
              href={`https://wa.me/${clientEnv.NEXT_PUBLIC_OWNER_WA}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-control w-fit items-center gap-2 rounded-pill bg-taupe-deep px-6 text-small font-semibold text-white"
            >
              <MessageCircle className="size-4" aria-hidden="true" />
              Chat on WhatsApp
            </a>
          </div>

          <nav aria-label="Shop" className="flex flex-col gap-2">
            <h2 className="text-small font-semibold text-ink">Shop</h2>
            {SHOP_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="flex h-tap items-center text-small text-muted hover:text-ink"
              >
                {label}
              </Link>
            ))}
          </nav>

          <nav aria-label="Policies" className="flex flex-col gap-2">
            <h2 className="text-small font-semibold text-ink">Policies</h2>
            {POLICY_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="flex h-tap items-center text-small text-muted hover:text-ink"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <ul className="flex flex-wrap justify-center gap-6 border-t border-line py-8">
          {TRUST.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2 text-small text-muted">
              <Icon className="size-4 text-taupe-deep" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>

        <p className="pb-8 text-center text-small text-muted">
          © {new Date().getFullYear()} Tirupati Jewelles. All rights reserved.
        </p>
      </Container>
    </footer>
  );
}
