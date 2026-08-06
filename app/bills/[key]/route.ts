/**
 * GET /bills/{key} — serve an invoice PDF.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.3). Closes DEBT-021.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THREE WAYS IN, AND THE BARE KEY IS NOT ONE OF THEM.
 *
 *  DEBT-021, raised by Phase 6 SECURITY: "An unguessable URL is not an authorised one —
 *  MASTER-SPEC's IDOR control requires the fetch to filter by the session's `userId`, not
 *  by the key alone."
 *
 *  So a request carrying nothing but the key gets a 404, even a correct key. What is
 *  accepted:
 *
 *    1. A valid, unexpired SIGNATURE. This is the WhatsApp link. The recipient has no
 *       account — that is the entire feature — so possession of a signed, expiring
 *       capability is the only proof available, and §8.3 names it: "served via a signed
 *       URL, 7-day expiry".
 *    2. The session user OWNS the order (`order.userId === session user`). This is
 *       MASTER-SPEC's IDOR control, applied literally.
 *    3. The session user is an ADMIN. The shop can always reprint its own invoice.
 *
 *  §8 SECURITY: "Bill PDF URL unguessable and unlisted; sequential guessing returns 404" —
 *  the key is a UUIDv4 and there is no sequential form of it. "Customer A cannot fetch
 *  customer B's bill by ID or by PDF key" — holding B's key is not enough; A would need
 *  B's signature, which is an HMAC A cannot compute.
 *
 *  Every failure is the SAME 404. A key that does not exist, a key whose signature is
 *  wrong, and a key belonging to someone else are indistinguishable from outside; anything
 *  else turns this route into an oracle for which invoices exist.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { getCurrentUser } from '@/lib/auth/guard';
import { readBillPdf, verifyBillSignature } from '@/lib/bills/storage';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** A UUIDv4 and nothing else — a malformed key never reaches the database. */
const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reduce an invoice number to characters that are safe in a header and on a filesystem.
 *
 * Anything outside the set becomes `-`, and an empty result falls back — a download named
 * `.pdf` is worse than one named `invoice.pdf`.
 */
function safeFilename(orderNo: string): string {
  return orderNo.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64) || 'invoice';
}

function notFound(): Response {
  // Plain text and no detail. The same body for "no such bill", "bad signature" and "not
  // yours", because the differences are exactly what an attacker is probing for.
  return new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  // Next 16: route params are async (D-002).
  const { key } = await params;
  if (!KEY_PATTERN.test(key)) return notFound();

  const order = await db.order.findFirst({
    where: { billPdfKey: key },
    select: { id: true, orderNo: true, userId: true },
  });
  if (!order) return notFound();

  const url = new URL(request.url);
  const signature = verifyBillSignature(
    key,
    url.searchParams.get('e'),
    url.searchParams.get('s'),
  );

  let allowed = signature === 'valid';

  if (!allowed) {
    // Only consulted when there is no valid signature, so the WhatsApp path never touches
    // Redis or the users table.
    const user = await getCurrentUser();
    allowed = Boolean(user && (user.role === 'ADMIN' || user.id === order.userId));
  }

  if (!allowed) return notFound();

  const stored = await readBillPdf(key);
  if (!stored) return notFound();

  return new Response(new Uint8Array(stored.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(stored.byteSize),
      /**
       * §8.3: "`X-Robots-Tag: noindex`."
       *
       * A crawler cannot reach a signed URL anyway, but the link travels through WhatsApp
       * and is pasted into other places by real people. `noarchive` is added because an
       * indexer that ignores `noindex` will happily cache the bytes.
       */
      'X-Robots-Tag': 'noindex, nofollow, noarchive, noimageindex',
      /**
       * `inline`, so tapping the WhatsApp link opens the invoice rather than downloading a
       * file the customer then has to find. The filename is the invoice number, which is
       * what it should be called once saved.
       *
       * Sanitised rather than interpolated (SEC-021). `orderNo` is server-generated, but its
       * prefix comes from Settings, and a header value is the wrong place to find out that
       * an admin typed something unexpected: the runtime throws on CR/LF, which would turn
       * every affected invoice into a permanent 500. The schema now restricts the prefix
       * too; this is the layer that does not depend on that staying true.
       */
      'Content-Disposition': `inline; filename="${safeFilename(order.orderNo)}.pdf"`,
      /**
       * Never cached by a shared cache. `private` alone would still permit a proxy to hold
       * it; §8 SECURITY's "no public-read bucket ACL" is the same requirement one layer up,
       * and the equivalent here is that nothing but the browser ever keeps a copy.
       */
      'Cache-Control': 'private, no-store, max-age=0',
      // The global header set already sends X-Frame-Options: DENY and nosniff. Repeated
      // here so this route's guarantees do not depend on next.config.ts staying as it is.
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
