/**
 * POST /api/enquiry — record that someone tapped through to WhatsApp.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.3).
 *
 * Feeds the Phase 7 admin dashboard. Deliberately minimal: §6.3 logs "product, timestamp,
 * session" and this stores exactly that. An enquiry is a signal that a piece drew
 * interest, not a record about a person — no name, no number, no message text. We do not
 * have those at this point and should not start collecting them here.
 *
 * ── Why the failure mode is "return 204 anyway" ──
 * The caller is `navigator.sendBeacon`, fired as the customer navigates to WhatsApp. It
 * cannot read the response and there is nothing useful it could do with an error. An
 * analytics write must never be visible to a customer, so a bad body or a dead database
 * produces the same silent success and a server-side log.
 */
import { z } from 'zod';

import { createHmac } from 'node:crypto';

import { getSessionId } from '@/lib/auth/session';
import { consume } from '@/lib/auth/rate-limit';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { NO_STORE, clientIp, requireSameOrigin } from '@/lib/http';

export const dynamic = 'force-dynamic';

const enquirySchema = z.object({
  productId: z.uuid().optional(),
  source: z.enum(['PRODUCT', 'FLOATING']),
});

/** Generous — a real visitor produces a handful — but bounded, since this is a public write. */
const ENQUIRY_LIMIT = { limit: 60, windowSeconds: 60 * 60 };

/** Beacons cannot read a response; 204 is the honest status for "noted, nothing to say". */
const noContent = () => new Response(null, { status: 204, headers: NO_STORE });

export async function POST(request: Request) {
  // CSRF: reject a cross-origin state change (Phase 7 §7 SECURITY).
  const crossOrigin = await requireSameOrigin();
  if (crossOrigin) return crossOrigin;

  try {
    const ip = await clientIp();
    const limit = await consume({ key: `enquiry:ip:${ip}`, ...ENQUIRY_LIMIT });
    if (!limit.allowed) return noContent();

    /**
     * A malformed or empty body is an ordinary event here, not an exception.
     *
     * `sendBeacon` fires as the page unloads, and browsers do deliver the occasional
     * bodyless request — plus this is a public endpoint anyone can POST to. Letting
     * `request.json()` throw into the outer catch logged a stack trace for each one, which
     * buries the failures that matter. Parsed explicitly and answered with the same silent
     * 204 as everything else.
     */
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return noContent();
    }

    const parsed = enquirySchema.safeParse(raw);
    if (!parsed.success) return noContent();

    const { productId, source } = parsed.data;

    await db.enquiry.create({
      data: {
        // A stale or spoofed id would fail the foreign key, so the product is checked
        // first and an unknown one records a source-only enquiry rather than throwing.
        productId: productId && (await productExists(productId)) ? productId : null,
        sessionId: await sessionFingerprint(),
        source,
      },
    });

    return noContent();
  } catch (err) {
    // Logged for us, invisible to the customer — they are already on their way to
    // WhatsApp and there is nothing they could do about it.
    log.error('enquiry write failed', { err });
    return noContent();
  }
}

async function productExists(id: string): Promise<boolean> {
  const row = await db.product.findUnique({ where: { id }, select: { id: true } });
  return row !== null;
}

/**
 * A stable, non-reversible grouping key for one visitor's session.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  The session cookie value is a CREDENTIAL. It must never be stored here.
 *
 *  §6.3 asks the enquiry log to record "session", and the useful question it answers is
 *  "did one visitor enquire about four bangles, or did four visitors each enquire about
 *  one?". That needs a value that is *stable per session* and *tells you nothing else*.
 *
 *  Writing the raw session id into an analytics table would mean a leak of that table is a
 *  session-hijacking kit: `session:{sid}` is the Redis key, and anyone holding the sid can
 *  set the cookie and be that user. An HMAC keyed on `SESSION_SECRET` gives the same
 *  grouping with none of that — it cannot be reversed, and it cannot be replayed as a
 *  cookie.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Truncated to 32 hex characters: 128 bits is far past collision concerns for this, and a
 * shorter value is a smaller thing to store about someone.
 */
async function sessionFingerprint(): Promise<string | null> {
  const sid = await getSessionId();
  if (!sid) return null;

  return createHmac('sha256', env.SESSION_SECRET)
    .update(`enquiry:${sid}`)
    .digest('hex')
    .slice(0, 32);
}
