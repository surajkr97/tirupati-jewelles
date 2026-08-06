/**
 * The WhatsApp send layer.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §8: "Why the deep link, not the Cloud API: `wa.me` is free, needs no Meta Business
 *  verification, and works today. The one compromise is that the admin taps send manually.
 *  The send layer is behind an interface so the Cloud API can replace it later without
 *  touching the rest."
 *
 *  So the interface is the deliverable, not an abstraction for its own sake. Two
 *  implementations exist: `DeepLinkSender`, which returns a URL for the admin's browser to
 *  open, and `CloudApiSender`, which is a declared stub. The stub is not dead code — it is
 *  what proves the interface can express a real server-side send, which an interface with
 *  one implementation never proves.
 *
 *  ── What `sendBill` does NOT do ──
 *  It does not mark the bill sent. §8.4: "After the admin returns from WhatsApp, show a
 *  `Mark as sent` confirmation → sets `sentViaWa` and `sentAt`. **Do not set it
 *  optimistically** — the admin may have cancelled, and a false 'sent' record is worse than
 *  no record." A deep link cannot know whether the message left the phone, so it says so in
 *  its result (`delivery: 'manual'`) rather than pretending.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Client-safe by construction: no `server-only`, no database, no secrets. The bill detail
 * screen builds the link in the browser from values the server already rendered.
 */
import { buildWhatsAppUrl } from '@/lib/catalog/whatsapp';
import { formatINR } from '@/lib/money';

export interface SendBillInput {
  /** E.164, e.g. `+919876543210`. Normalised before it reaches here. */
  phone: string;
  /** Used in the greeting. Free text — the encoder is what makes it safe. */
  customerName: string | null;
  shopName: string;
  orderNo: string;
  total: bigint;
  pdfUrl: string;
  siteUrl: string;
  /**
   * Absolute `/claim/{token}` link, when one could be minted (DEBT-011).
   *
   * Absent when the number already belongs to a verified account — the purchase is already
   * in their history, so a claim link would be an invitation to do nothing. Absent also on a
   * resend of a bill whose token has been used or has expired.
   */
  claimUrl?: string | null;
}

export type SendResult =
  /**
   * The message is composed and the admin must tap send. `url` opens WhatsApp with the
   * text prefilled.
   */
  | { ok: true; delivery: 'manual'; url: string; message: string }
  /** A server-side send that the provider accepted. */
  | { ok: true; delivery: 'automatic'; providerMessageId: string }
  | { ok: false; error: string };

export interface WhatsAppSender {
  readonly id: 'deep-link' | 'cloud-api';
  sendBill(input: SendBillInput): Promise<SendResult>;
}

/**
 * §8.4's message, exactly as written.
 *
 * Plain text and no markup: WhatsApp renders `_` and `*` as formatting, so nothing here
 * wraps a value in them — a customer named `Anil_K` would otherwise italicise half the
 * message. The same rule Phase 6 applied to product names.
 *
 * Exported so a test can assert the round trip through `buildWhatsAppUrl` rather than
 * against a hand-written expected string, which would only re-encode the same mistake.
 */
export function buildBillMessage(input: SendBillInput): string {
  const greeting = input.customerName?.trim()
    ? `Namaste ${input.customerName.trim()},`
    : 'Namaste,';

  /**
   * §8.4's template says "View your purchase history: {siteUrl}/account/orders".
   *
   * When a claim token exists the link becomes `/claim/{token}` instead (D-030). The label
   * is unchanged because the destination is the same promise — but the plain link only works
   * for someone who already has an account with this number verified, which is precisely the
   * customer this feature is NOT for. The token is what turns the line into the thing §8's
   * flow diagram describes.
   *
   * This message is the delivery mechanism for a possession proof, so the link must go to
   * the number and nowhere else. Nothing here logs it.
   */
  const historyLine = input.claimUrl
    ? `See all your purchases: ${input.claimUrl}`
    : `View your purchase history: ${input.siteUrl}/account/orders`;

  return [
    greeting,
    '',
    `Thank you for your purchase from ${input.shopName}.`,
    '',
    `Invoice: ${input.orderNo}`,
    `Amount: ${formatINR(input.total)}`,
    '',
    `Your invoice: ${input.pdfUrl}`,
    '',
    historyLine,
    '',
    'For any questions, reply to this message.',
  ].join('\n');
}

/**
 * The implementation in use today.
 *
 * `buildWhatsAppUrl` is Phase 6's, unchanged, because the encoding requirement is
 * identical and MASTER-SPEC's control — "Never let it break out of the `text=` param" — is
 * one `encodeURIComponent` call that should exist once. §8.4 says "`encodeURIComponent` the
 * whole message. SECURITY tests this"; it is tested against Phase 6's function.
 */
export class DeepLinkSender implements WhatsAppSender {
  readonly id = 'deep-link' as const;

  async sendBill(input: SendBillInput): Promise<SendResult> {
    const message = buildBillMessage(input);
    return {
      ok: true,
      delivery: 'manual',
      url: buildWhatsAppUrl(input.phone, message),
      message,
    };
  }
}

/**
 * The replacement, declared and deliberately not implemented.
 *
 * DEBT-004 lists "WhatsApp Cloud API auto-send" as post-launch, and MASTER-SPEC §2 forbids
 * building post-launch items now. Returning a failure rather than throwing means selecting
 * it by configuration degrades to a visible error on one screen instead of a 500 across the
 * admin panel — and the compile-time proof that the interface fits a real API is the point
 * of the class existing at all.
 */
export class CloudApiSender implements WhatsAppSender {
  readonly id = 'cloud-api' as const;

  async sendBill(_input: SendBillInput): Promise<SendResult> {
    void _input;
    return {
      ok: false,
      error:
        'The WhatsApp Cloud API sender is not implemented. Set WHATSAPP_SENDER=deep-link.',
    };
  }
}

export type SenderId = WhatsAppSender['id'];

/**
 * §8.4: "Swap via config."
 *
 * The id comes from the caller rather than being read from `process.env` here, because
 * `lib/env.ts` is the only file permitted to touch it (AGENTS.md) and this module is
 * client-safe. An unknown id falls back to the deep link — the working sender — rather
 * than failing closed on a typo in an environment variable.
 */
export function getSender(id: string = 'deep-link'): WhatsAppSender {
  return id === 'cloud-api' ? new CloudApiSender() : new DeepLinkSender();
}
