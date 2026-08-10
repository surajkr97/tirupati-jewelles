/**
 * Sticky enquiry bar — the final CTA.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.3).
 *
 * MASTER-SPEC §1: "there is no checkout. The final CTA is _Enquire on WhatsApp_."
 *
 * ── On the logging ──
 * §6.3: "Log the enquiry ... **before** opening the link — fire-and-forget, must never
 * block or delay the redirect."
 *
 * Both halves of that matter. The log has to be *dispatched* before the navigation or the
 * page may be gone before it fires, and it must not be *awaited* or a slow network turns
 * the shop's main call to action into a spinner. `sendBeacon` is exactly this contract:
 * the browser guarantees delivery independently of the page's lifetime, and it returns
 * immediately. The `fetch(keepalive)` fallback is for browsers without it.
 */
'use client';

import { MessageCircle } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { StickyBar } from '@/components/shell/sticky-bar';
import { clientEnv } from '@/lib/env';
import {
  buildEnquiryMessage,
  buildWhatsAppUrl,
  type EnquiryProduct,
} from '@/lib/catalog/whatsapp';
import { formatINR } from '@/lib/money';
import { cn } from '@/lib/utils/cn';

export function EnquiryBar({
  product,
  productId,
  ownerWhatsApp,
}: {
  product: EnquiryProduct;
  productId: string;
  /** DEBT-050: the shop's saved number, from `getShopContact()` on the server. */
  ownerWhatsApp: string;
}) {
  /**
   * Computed during render, from build-time config.
   *
   * Deliberately not derived from `window.location.origin` in an effect: that would ship
   * server HTML with the wrong link, correct it only after hydration, and leave it wrong
   * for anyone without JavaScript. `NEXT_PUBLIC_SITE_URL` is identical on both sides, so
   * the href is right in the very first byte of HTML.
   */
  const href = useMemo(
    () =>
      buildWhatsAppUrl(
        ownerWhatsApp,
        buildEnquiryMessage(product, clientEnv.NEXT_PUBLIC_SITE_URL),
      ),
    [product, ownerWhatsApp],
  );

  const logEnquiry = useCallback(() => {
    const body = JSON.stringify({ productId, source: 'PRODUCT' });

    try {
      if (navigator.sendBeacon) {
        // Queued by the browser and delivered even if this page is unloading. It returns
        // a boolean immediately — nothing here can delay the navigation.
        navigator.sendBeacon(
          '/api/enquiry',
          new Blob([body], { type: 'application/json' }),
        );
        return;
      }

      void fetch('/api/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        // Survives the navigation that is about to happen.
        keepalive: true,
      }).catch(() => {
        // An analytics write must never surface to a customer.
      });
    } catch {
      // Same.
    }
  }, [productId]);

  return (
    <StickyBar testId="enquiry-bar">
      <div className="min-w-0 flex-1">
        <p className="text-small text-muted">Indicative price</p>
        <p className="truncate text-h3 font-semibold text-ink tabular">
          {formatINR(product.lineTotal)}
        </p>
      </div>

      {/*
          A real anchor, not a button with an onClick navigation. It must work with
          JavaScript disabled, open in a new tab on a long-press, and be copyable — all of
          which a scripted navigation breaks.

          `noopener` is not optional on a `_blank` link: without it the opened page gets a
          handle on `window.opener` and can navigate this tab elsewhere.
        */}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={logEnquiry}
        data-testid="enquire-cta"
        className={cn(
          'inline-flex h-control shrink-0 items-center justify-center gap-2 rounded-pill px-6',
          // taupeDeep, not taupe: white on plain taupe is 3.53:1 and fails AA (D-007).
          'bg-taupe-deep text-body font-semibold text-white',
          'transition-transform duration-fast ease-standard active:scale-[0.98]',
        )}
      >
        <MessageCircle className="size-icon" aria-hidden="true" />
        Enquire on WhatsApp
      </a>
    </StickyBar>
  );
}
