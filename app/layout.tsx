/**
 * Root layout.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.7).
 *
 * The storefront shell (header, bottom nav, footer) lives in `app/(app)/layout.tsx`, not
 * here — /admin and the Phase 3 auth screens deliberately do not get it.
 */
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import { Toaster } from '@/components/ui';
import { SITE_URL } from '@/lib/seo';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const SITE_NAME = 'Tirupati Jewelles';
// Deliberately not "live rates": the ticker shows an admin-set indicative rate, and
// MASTER-SPEC §8 is explicit that claiming otherwise is the consumer-protection exposure
// this build is mitigating. See DEBT-002. This wording is repeated into the OG description
// rather than a second one being written, for the same reason RateDisclaimer is one
// component — a claim about pricing must not have two versions.
const SITE_DESCRIPTION =
  "Today's gold and silver rates, price calculator, and hallmark-certified jewellery.";

export const metadata: Metadata = {
  /**
   * §9.6 (canonical URLs). Every relative URL Next resolves for metadata — canonical,
   * `og:url`, `og:image` — is resolved against this. Without it Next warns and falls back to
   * `localhost:3000`, which is invisible in development and produces canonicals pointing at
   * a developer's machine in production.
   *
   * Routes still set an ABSOLUTE canonical through `lib/seo.ts`, so a missing or wrong
   * `metadataBase` cannot silently redirect the whole site's canonical to the wrong origin.
   */
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    // A route's own title becomes "Gold 22K necklace · Tirupati Jewelles".
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_IN',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  robots: {
    // The storefront is indexable. `/admin`, `/bills` and the account tree send their own
    // `noindex` from their layouts (§7.1, DEBT-021) and are disallowed in robots.ts; this
    // default must not be read as overriding them.
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never disable zoom — pinch-to-zoom is an accessibility requirement, and Phase 9 §9.7
  // runs an axe pass that will flag it.
  maximumScale: 5,
  themeColor: '#FAF7F4',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={inter.variable}>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
