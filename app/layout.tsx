/**
 * Root layout.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.7).
 *
 * The storefront shell (header, bottom nav, footer) lives in `app/(app)/layout.tsx`, not
 * here — /admin and the Phase 3 auth screens deliberately do not get it.
 */
import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';

import { Toaster } from '@/components/ui';
import { SITE_URL } from '@/lib/seo';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

/**
 * The editorial serif, for headlines only (redesign brief §6, D-056).
 *
 * Playfair over Instrument Serif or Fraunces: its high stroke contrast and vertical stress
 * are what the reference image's headline is doing, and it is the only one of the three with
 * a variable weight axis, so 400–500 costs one file rather than two.
 *
 * `weight` is capped at 500 deliberately. The brief's §6 rule is "maximum normal weight
 * 500", and a display serif is where over-weighting reads as cheap fastest — the elegance is
 * supposed to come from scale and spacing, not from bolding. Asking for only what is used
 * also keeps the download small.
 *
 * `preload: false` because no route renders serif text above the fold yet — the hero that
 * will arrives in Stage 4. Preloading a font nothing paints costs a request on every page
 * for nothing. Flip this to the default when the hero ships.
 */
const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500'],
  variable: '--font-playfair',
  preload: false,
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
  // Must equal --color-cream. The one hex outside globals.css; PWA metadata needs a
  // literal, so it cannot read the token. D-057 moved cream to #FAF7F5.
  themeColor: '#FAF7F5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${playfair.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
