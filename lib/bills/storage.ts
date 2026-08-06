/**
 * Bill PDF storage and the signed URLs that reach it.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.3).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §8.3 storage, in full: "Key: `bills/{uuidv4}.pdf` — never sequential, never guessable.
 *  Private bucket; served via a signed URL, 7-day expiry, or through an ownership-checked
 *  route. `X-Robots-Tag: noindex`. Cache the signed URL in Redis at `bill:{key}`, 24h."
 *
 *  ── Why BOTH a signed URL and an ownership check, when §8.3 says "or" ──
 *  The two access paths are genuinely different and each needs its own control:
 *
 *    WhatsApp   The recipient has NO ACCOUNT. That is the whole feature — §8's flow ends
 *               with "Customer later verifies that phone → order attaches". An
 *               ownership-checked route cannot serve them, so this link must be a
 *               capability: unguessable, signed, and expiring.
 *    Account    A signed-in customer opening their own bill. Here MASTER-SPEC's IDOR
 *               control applies in full — "Every fetch of an order/bill filters by `userId`
 *               from the session, never by an ID from the URL alone" — and DEBT-021 is the
 *               open item saying so.
 *
 *  So the route accepts either proof and nothing else. A bare key with no signature is not
 *  an authorisation, which is exactly what DEBT-021 asked for.
 *
 *  ── Why the signature, when the key is already a UUIDv4 ──
 *  A UUIDv4 is unguessable but permanent. §8.3 requires expiry, and a key alone cannot
 *  expire without deleting the bill — which §8.5's retention note forbids. The signature
 *  carries the deadline, so the link dies while the invoice lives.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { db } from '@/lib/db';
import { clientEnv, env } from '@/lib/env';
import { cached, invalidate } from '@/lib/redis';

/** §8.3: "7-day expiry". */
export const BILL_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** §8.3: "Cache the signed URL in Redis at `bill:{key}`, 24h." */
export const BILL_URL_CACHE_TTL = 24 * 60 * 60;

export function billCacheKey(key: string): string {
  return `bill:${key}`;
}

/**
 * §8.3: "Key: `bills/{uuidv4}.pdf`".
 *
 * Stored and routed as the bare UUID; `bills/` is the route prefix and `.pdf` the
 * `Content-Disposition` filename, so the two decorations live where they mean something
 * rather than inside a database identifier.
 */
export function newBillKey(): string {
  return randomUUID();
}

/**
 * The HMAC key.
 *
 * Derived from `SESSION_SECRET` rather than used directly, and domain-separated with a
 * versioned label. Phase 6 (SEC-013) already keys an HMAC on the same secret; two different
 * MACs sharing one key means a value forged for one is valid for the other, and the label
 * makes that impossible without a second environment variable to lose.
 */
function signingKey(): Buffer {
  return createHmac('sha256', env.SESSION_SECRET).update('bill-url-v1').digest();
}

function sign(key: string, expiresAtSeconds: number): string {
  return createHmac('sha256', signingKey())
    .update(`${key}.${expiresAtSeconds}`)
    .digest('base64url');
}

/**
 * A signed, expiring path for one bill: `/bills/{key}?e=…&s=…`.
 *
 * Relative, because the caller decides whether it needs an origin. The WhatsApp message
 * prefixes `NEXT_PUBLIC_SITE_URL`; the account page does not need to.
 */
export function signedBillPath(key: string, expiresAt: Date): string {
  const expiry = Math.floor(expiresAt.getTime() / 1000);
  return `/bills/${key}?e=${expiry}&s=${sign(key, expiry)}`;
}

export function absoluteBillUrl(key: string, expiresAt: Date): string {
  return `${clientEnv.NEXT_PUBLIC_SITE_URL}${signedBillPath(key, expiresAt)}`;
}

export type SignatureCheck = 'valid' | 'expired' | 'invalid' | 'absent';

/**
 * Verify a signature from a request URL.
 *
 * Compared with `timingSafeEqual` on equal-length buffers. A byte-by-byte `===` on a MAC is
 * a forgery oracle in principle; here the attacker would need ~10^5 requests per byte
 * against a rate-limited route, so this is cheap correctness rather than a live threat.
 */
export function verifyBillSignature(
  key: string,
  expiryParam: string | null,
  signatureParam: string | null,
  now: Date = new Date(),
): SignatureCheck {
  if (!expiryParam || !signatureParam) return 'absent';

  // Digits only. `Number('12e9')` is a valid number and a nonsense timestamp.
  if (!/^\d{1,12}$/.test(expiryParam)) return 'invalid';
  const expiry = Number(expiryParam);

  const expected = Buffer.from(sign(key, expiry), 'utf8');
  const supplied = Buffer.from(signatureParam, 'utf8');

  // Length is public — a MAC's length is fixed and known — so an early return here leaks
  // nothing, and `timingSafeEqual` throws on mismatched lengths.
  if (expected.length !== supplied.length) return 'invalid';
  if (!timingSafeEqual(expected, supplied)) return 'invalid';

  /**
   * Expiry is checked AFTER the signature, deliberately.
   *
   * The other order tells an attacker with a random `e` and a random `s` whether their
   * timestamp was in range, which is a free bit about a value they control anyway — but it
   * also means "expired" could be reported for a link that was never valid, and the two
   * mean very different things to a customer standing in front of the shop.
   */
  return expiry * 1000 <= now.getTime() ? 'expired' : 'valid';
}

// ── Bytes ──────────────────────────────────────────────────────────────────

export interface StoredBill {
  key: string;
  bytes: Buffer;
  byteSize: number;
  expiresAt: Date;
}

/**
 * Node hands `renderToBuffer` a `Buffer`, which is a `Uint8Array<ArrayBufferLike>`; Prisma's
 * `Bytes` column wants a `Uint8Array<ArrayBuffer>` specifically. The two differ only in
 * whether the backing store could be a `SharedArrayBuffer`, which a PDF render never
 * produces — so this is a type-level narrowing, made explicit rather than cast away.
 */
function toBytesColumn(bytes: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

/**
 * Persist a rendered invoice.
 *
 * Written after the order commits — see `createBill`'s note on why the render is
 * deliberately outside the transaction that hands out the invoice number.
 */
export async function storeBillPdf(
  orderId: string,
  key: string,
  bytes: Buffer,
  expiresAt: Date,
): Promise<void> {
  await db.billPdf.create({
    data: {
      key,
      orderId,
      bytes: toBytesColumn(bytes),
      byteSize: bytes.byteLength,
      expiresAt,
    },
  });
}

/** Replace a bill's rendered bytes — a re-render after a void, or a recovered failure. */
export async function replaceBillPdf(
  orderId: string,
  key: string,
  bytes: Buffer,
  expiresAt: Date,
): Promise<void> {
  const data = { bytes: toBytesColumn(bytes), byteSize: bytes.byteLength, expiresAt };

  await db.billPdf.upsert({
    where: { orderId },
    create: { key, orderId, ...data },
    update: { key, ...data },
  });
  await invalidate(billCacheKey(key));
}

export async function readBillPdf(key: string): Promise<StoredBill | null> {
  const row = await db.billPdf.findUnique({
    where: { key },
    select: { key: true, bytes: true, byteSize: true, expiresAt: true },
  });
  if (!row) return null;

  return {
    key: row.key,
    bytes: Buffer.from(row.bytes),
    byteSize: row.byteSize,
    expiresAt: row.expiresAt,
  };
}

/**
 * The signed URL for a bill, cached in Redis for 24h (§8.3).
 *
 * Caching a value this cheap to recompute is not about the HMAC. It is about STABILITY: an
 * admin who opens the bill twice, or resends it, should send the same link both times.
 * Minting a fresh deadline on every view would mean a customer holding two links to one
 * invoice that expire on different days.
 *
 * `cached()` never throws, so a Redis outage produces a freshly signed URL instead of an
 * error — slightly less stable, still correct.
 */
export async function getSignedBillUrl(key: string, expiresAt: Date): Promise<string> {
  return cached(billCacheKey(key), BILL_URL_CACHE_TTL, async () =>
    absoluteBillUrl(key, expiresAt),
  );
}
