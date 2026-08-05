/**
 * WhatsApp deep links.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.3).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MESSAGE IS USER-INFLUENCED TEXT IN A URL PARAMETER.
 *
 *  MASTER-SPEC's risk table: "The prefilled message is user-influenced text. URL-encode it.
 *  Never let it break out of the `text=` param."
 *
 *  §6.3: "`encodeURIComponent` **is mandatory.** Product names contain `&`, `#`, and
 *  quotes; unencoded they truncate the message or break the link. SECURITY checks this
 *  specifically."
 *
 *  A product name is admin-entered, so this is not a hostile-input problem so much as an
 *  everyday-correctness one: a shop that sells a "Ring & Chain #2" set will otherwise send
 *  a message that stops at the ampersand. Both failure modes have the same fix, and it
 *  lives in exactly one function.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Client-safe — the enquiry CTA is a client component. The owner's number comes from
 * `NEXT_PUBLIC_OWNER_WA`, which `lib/env.ts` validates as digits-only at boot.
 */
import { formatINR } from '@/lib/money';
import type { PurityKey } from '@/lib/pricing';

export interface EnquiryProduct {
  name: string;
  slug: string;
  purity: PurityKey;
  weightMg: number;
  /** Indicative total in paise. */
  lineTotal: bigint;
}

const PURITY_LABEL: Record<PurityKey, string> = {
  K22_916: '22K (916)',
  K18_750: '18K (750)',
  SILVER_999: 'Silver 999',
};

/** Grams with up to 3 decimals, trailing zeros trimmed — `8.475`, `10`. */
function grams(weightMg: number): string {
  return (weightMg / 1000).toFixed(3).replace(/\.?0+$/, '');
}

/**
 * The message body for a product enquiry, exactly as §6.3 lays it out.
 *
 * Plain text, no markup. WhatsApp renders `_` and `*` as formatting, so nothing here wraps
 * a value in them — a product name containing an underscore would otherwise silently
 * italicise half the message.
 */
export function buildEnquiryMessage(product: EnquiryProduct, siteUrl: string): string {
  return [
    "Hi! I'm interested in this piece.",
    '',
    product.name,
    `${PURITY_LABEL[product.purity]} · ${grams(product.weightMg)}g`,
    `Ref: ${product.slug}`,
    `Indicative price: ${formatINR(product.lineTotal)}`,
    '',
    `${siteUrl}/products/${product.slug}`,
    '',
    'Could you share more details?',
  ].join('\n');
}

/** The site-wide floating button (§6.3) — no product context. */
export function buildGeneralMessage(siteUrl: string): string {
  return ["Hi! I'd like to know more about your jewellery.", '', siteUrl].join('\n');
}

/**
 * Build a `wa.me` link.
 *
 * ── Why `encodeURIComponent` and not `URLSearchParams` ──
 * §6.3 names `encodeURIComponent` specifically, and the difference is not stylistic.
 * `URLSearchParams` serialises with `application/x-www-form-urlencoded` rules, which encode
 * a space as `+`. Whether `wa.me` decodes `+` back to a space or shows it literally is
 * WhatsApp's business, not ours — and the failure mode is
 * `Hi!+I'm+interested+in+this+piece` in the shop's primary call to action.
 * `encodeURIComponent` emits `%20`, which every parser agrees on.
 *
 * It escapes everything that matters here: `&` and `#` (which would truncate the message),
 * `=`, quotes, angle brackets and newlines. MASTER-SPEC's control — "Never let it break out
 * of the `text=` param" — is exactly this call.
 *
 * The phone number is digits-only by `lib/env.ts`'s schema, and is stripped again rather
 * than trusted: Phase 8 calls this with customer numbers, and a `+` or a space in the path
 * segment breaks the link silently.
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * Recover the message from a `wa.me` URL.
 *
 * Exists for the tests — §6 TEST: "WhatsApp link decodes back to the intended message." A
 * round-trip assertion is the only one that actually proves the encoding, because a
 * hand-written expected string just re-encodes the same mistake.
 */
export function parseWhatsAppUrl(url: string): { phone: string; message: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'wa.me') return null;

    const phone = parsed.pathname.replace(/^\//, '');
    const message = parsed.searchParams.get('text');
    if (!phone || message === null) return null;

    return { phone, message };
  } catch {
    return null;
  }
}
