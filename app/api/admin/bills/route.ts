/**
 * POST /api/admin/bills — raise a bill. ADMIN only.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §8 SECURITY: "Only ADMIN can create bills." · "Rate limit bill creation (20/min) to
 *  bound abuse of a compromised admin session." · "Every bill creation and send audited."
 *
 *  The rate limit is the unusual one, and worth reading twice: it does not protect against
 *  an outsider — an outsider cannot reach this route at all — it bounds what a STOLEN
 *  ADMIN SESSION can do before anyone notices. Twenty bills a minute is more than a jeweller
 *  will ever raise by hand and few enough that a script cannot fill the invoice book.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The work is in `lib/bills/create.ts`. This file is the boundary: who, from where, how
 * often, and whether the phone is real.
 */
import { requireAdmin, UnauthorisedError } from '@/lib/auth/guard';
import { normalisePhone } from '@/lib/auth/identifier';
import { consume } from '@/lib/auth/rate-limit';
import { createBill } from '@/lib/bills/create';
import { createBillSchema, idempotencyKeySchema } from '@/lib/bills/schema';
import {
  clientIp,
  errorJson,
  json,
  parseBody,
  requireSameOrigin,
  serverError,
} from '@/lib/http';

export const dynamic = 'force-dynamic';

/** §8 SECURITY: "Rate limit bill creation (20/min)". */
const BILL_LIMIT = { limit: 20, windowSeconds: 60 };

export async function POST(request: Request) {
  /**
   * Authorisation FIRST, then CSRF (SEC-016).
   *
   * `requireSameOrigin` answers 403, and a 403 from `/api/admin/bills` confirms the route
   * exists to a caller who should be told nothing. Everyone who is not an admin — signed
   * out, or a signed-in customer — gets the same 404 regardless of where they posted from.
   */
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof UnauthorisedError) return errorJson('Not found', 404);
    throw err;
  }

  const crossOrigin = await requireSameOrigin();
  if (crossOrigin) return crossOrigin;

  const parsed = await parseBody(request, createBillSchema);
  if (!parsed.ok) return parsed.response;

  /**
   * §8.2's idempotency key.
   *
   * Read from the header, not the body, so it stays out of the `.strict()` payload that
   * must contain nothing but items and customer details. An absent header is allowed —
   * two genuinely identical bills (the same ring, sold twice in a day) must remain
   * possible — but a malformed one is rejected rather than silently ignored, because a
   * client that thinks it has protection and does not is worse off than one that knows it
   * has none.
   */
  const rawKey = request.headers.get('idempotency-key');
  let idempotencyKey: string | undefined;
  if (rawKey !== null) {
    const key = idempotencyKeySchema.safeParse(rawKey);
    if (!key.success) {
      return errorJson('Idempotency-Key must be 8–128 url-safe characters.', 400);
    }
    idempotencyKey = key.data;
  }

  /**
   * Phase 3 left this instruction against this exact line: "Phase 8 must call
   * `normalisePhone()` on `customerPhone` before writing a bill. A bill stored as
   * `9876543210` will never be claimed by a customer who verifies `+919876543210` — there
   * is a test asserting exactly that failure mode."
   *
   * The claim in `lib/auth/claim.ts` matches `customerPhone` exactly, so this call is the
   * whole of the flagship feature working or not working.
   */
  const customerPhone = normalisePhone(parsed.data.customerPhone);
  if (!customerPhone) {
    return errorJson('Enter a valid Indian mobile number.', 400, {
      fields: { customerPhone: 'That is not a valid Indian mobile number.' },
    });
  }

  try {
    const ip = await clientIp();

    const limit = await consume({ key: `bill:create:${admin.id}`, ...BILL_LIMIT });
    if (!limit.allowed) {
      return errorJson('Too many bills just now. Try again in a moment.', 429, {
        retryAfter: limit.retryAfter,
      });
    }

    const result = await createBill(parsed.data, {
      adminId: admin.id,
      ip,
      customerPhone,
      idempotencyKey,
    });

    if (!result.ok) {
      return errorJson(result.error, 400, result.field ? { field: result.field } : {});
    }

    return json(
      {
        orderId: result.orderId,
        orderNo: result.orderNo,
        grandTotal: result.grandTotal.toString(),
        // Told plainly, so the UI can say "already created" rather than showing a second
        // success toast for a bill that was raised twenty seconds ago.
        replayed: result.replayed,
        path: `/admin/bills/${result.orderId}`,
      },
      result.replayed ? 200 : 201,
    );
  } catch (err) {
    return serverError(err, 'admin/bills');
  }
}
