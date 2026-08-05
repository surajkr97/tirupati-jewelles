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

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Tirupati Jewelles',
  // Deliberately not "live rates": the ticker shows an admin-set indicative rate, and
  // MASTER-SPEC §8 is explicit that claiming otherwise is the consumer-protection
  // exposure this build is mitigating. See DEBT-002.
  description:
    "Today's gold and silver rates, price calculator, and hallmark-certified jewellery.",
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
