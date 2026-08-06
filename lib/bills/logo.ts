/**
 * The invoice logo, fetched safely and cached.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.3: "Logo from a MediaSlot").
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  A BILL RENDER MUST NOT DEPEND ON A NETWORK CALL SUCCEEDING.
 *
 *  §8.3 generates the PDF synchronously inside the route handler, and the logo lives at an
 *  admin-supplied URL on a third-party CDN. Left naive, that puts a 5-second timeout on
 *  someone else's server in the middle of the shop's most important action.
 *
 *  So: the bytes are cached in Redis for six hours, and every failure — unreachable host,
 *  wrong format, cache miss during an outage — returns null and the invoice falls back to
 *  a typographic wordmark. A bill without a logo is a bill. A bill that would not generate
 *  is a customer standing at the counter.
 *
 *  The fetch itself goes through Phase 7 §7.7's pinned-IP guard, unchanged. An admin URL
 *  is still an SSRF vector, and "we only fetch it for the PDF" is not a mitigation.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import { db } from '@/lib/db';
import { checkImageUrl } from '@/lib/media/fetch-image';
import { cached, invalidate } from '@/lib/redis';

export const BILL_LOGO_SLOT = 'BILL_LOGO';
const LOGO_CACHE_KEY = 'bill:logo';
const LOGO_CACHE_TTL = 6 * 60 * 60;

/**
 * PDF embeds JPEG and PNG. Nothing else.
 *
 * Not a stylistic restriction — it is what the format supports. A WebP logo passes §7.7's
 * check, is a perfectly good image, and cannot go in a PDF, so it is filtered here with a
 * reason rather than failing inside the renderer.
 */
export type LogoFormat = 'png' | 'jpg';

export interface BillLogo {
  data: Buffer;
  format: LogoFormat;
}

/** What is cached: base64, because a Buffer does not survive JSON. */
interface CachedLogo {
  base64: string;
  format: LogoFormat;
}

export async function getBillLogo(): Promise<BillLogo | null> {
  const entry = await cached<CachedLogo | null>(LOGO_CACHE_KEY, LOGO_CACHE_TTL, load);
  if (!entry) return null;

  return { data: Buffer.from(entry.base64, 'base64'), format: entry.format };
}

/** Called when the slot changes, so the next bill picks up the new logo immediately. */
export async function invalidateBillLogo(): Promise<void> {
  await invalidate(LOGO_CACHE_KEY);
}

async function load(): Promise<CachedLogo | null> {
  const slot = await db.mediaSlot.findUnique({
    where: { slotKey: BILL_LOGO_SLOT },
    select: { imageUrl: true, isActive: true },
  });

  if (!slot?.isActive || !slot.imageUrl) return null;

  const check = await checkImageUrl(slot.imageUrl);
  if (!check.ok) {
    console.warn(`[bill logo] ${check.reason}: ${check.detail}`);
    return null;
  }

  if (check.format !== 'png' && check.format !== 'jpeg') {
    console.warn(`[bill logo] ${check.format} cannot be embedded in a PDF; skipping.`);
    return null;
  }

  return {
    base64: check.data.toString('base64'),
    // react-pdf names it `jpg`; the sniffer names it `jpeg`. One translation, here.
    format: check.format === 'jpeg' ? 'jpg' : 'png',
  };
}
