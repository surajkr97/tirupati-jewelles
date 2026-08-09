/**
 * Site-wide floating WhatsApp button.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.3).
 *
 * §6.3: "Floating WhatsApp button site-wide with a generic message."
 *
 * Hidden on the product page, where §6.3's sticky enquiry bar already occupies that corner
 * with a better, product-specific version of the same action. Two WhatsApp buttons on one
 * screen is a choice the visitor should not have to make.
 */
'use client';

import { MessageCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { buildGeneralMessage, buildWhatsAppUrl } from '@/lib/catalog/whatsapp';
import { clientEnv } from '@/lib/env';
import { cn } from '@/lib/utils/cn';

/** Routes with their own, better WhatsApp affordance. */
const SUPPRESSED = ['/products/'];

/**
 * Constant, so it is computed once at module load rather than per render — and identical
 * on the server and the client, because `NEXT_PUBLIC_SITE_URL` is inlined at build time.
 */
const HREF = buildWhatsAppUrl(
  clientEnv.NEXT_PUBLIC_OWNER_WA,
  buildGeneralMessage(clientEnv.NEXT_PUBLIC_SITE_URL),
);

export function WhatsAppFab() {
  const pathname = usePathname();

  if (SUPPRESSED.some((prefix) => pathname.startsWith(prefix))) return null;

  const logEnquiry = () => {
    try {
      const body = JSON.stringify({ source: 'FLOATING' });
      navigator.sendBeacon?.(
        '/api/enquiry',
        new Blob([body], { type: 'application/json' }),
      );
    } catch {
      // Analytics must never surface to a customer.
    }
  };

  return (
    <a
      href={HREF}
      target="_blank"
      // `noopener` matters on every `_blank`: without it the opened page can navigate
      // this tab.
      rel="noopener noreferrer"
      onClick={logEnquiry}
      aria-label="Ask us on WhatsApp"
      data-testid="whatsapp-fab"
      className={cn(
        'fixed right-[20px] z-30 md:right-[40px]',
        // Clears the mobile bottom nav, and sits at a normal inset on desktop where there
        // is none.
        'bottom-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom)+16px)] md:bottom-8',
        'flex size-control-lg items-center justify-center rounded-pill',
        'bg-taupe-deep text-white shadow-lift',
        'transition-transform duration-fast ease-standard active:scale-[0.98]',
        'focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none',
      )}
    >
      <MessageCircle className="size-6" aria-hidden="true" />
    </a>
  );
}
