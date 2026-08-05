/**
 * POST /api/admin/rates — set a rate. ADMIN only.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.2).
 *
 * §4 SECURITY: "rejects non-admin with 404" — a 403 confirms the route exists.
 * The role is re-checked here and not merely at the edge; `proxy.ts` says so in its own
 * header and §3.6 requires it.
 */
import { Metal, Purity } from '@prisma/client';
import { z } from 'zod';

import { requireAdmin, UnauthorisedError } from '@/lib/auth/guard';
import {
  clientIp,
  errorJson,
  json,
  parseBody,
  requireSameOrigin,
  serverError,
} from '@/lib/http';
import { fromDisplayUnit, isValidCombination, setRate } from '@/lib/rates';

export const dynamic = 'force-dynamic';

/**
 * Admin input is in RUPEES, in the display unit the shop thinks in (§4.2): ₹ per 10g for
 * gold, ₹ per kg for silver. Conversion to paise-per-gram happens here — the one place
 * unit conversion happens on input.
 */
const setRateSchema = z.object({
  metal: z.enum(['GOLD', 'SILVER']),
  purity: z.enum(['K22_916', 'K18_750', 'SILVER_999']),
  /**
   * Rupees in the display unit. Bounded on both sides: a rate of 0 would make every
   * product free, and the upper bound is what stops a fat-fingered extra digit becoming
   * an integer overflow rather than a caught mistake.
   */
  displayRupees: z.number().positive().max(100_000_000),
  confirmed: z.boolean().optional(),
});

export async function POST(request: Request) {
  /**
   * Authorisation FIRST, then CSRF — the order matters on an admin route.
   *
   * `requireSameOrigin` answers 403, and a 403 from `/api/admin/rates` tells an
   * unauthenticated caller the route exists. §3.6 and §4 SECURITY both require 404 for
   * everyone who is not an admin, so the identity check has to run first and swallow every
   * non-admin into the same 404 regardless of where they posted from.
   *
   * An admin posting cross-origin still gets the 403, which is the case the check is for.
   */
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    // 404, not 403 — do not confirm the route exists (§3.6).
    if (err instanceof UnauthorisedError) return errorJson('Not found', 404);
    throw err;
  }

  // CSRF: reject a cross-origin state change (Phase 7 §7 SECURITY).
  const crossOrigin = await requireSameOrigin();
  if (crossOrigin) return crossOrigin;

  const parsed = await parseBody(request, setRateSchema);
  if (!parsed.ok) return parsed.response;

  const { metal, purity, displayRupees, confirmed } = parsed.data;

  // Rejects GOLD/SILVER_999 and similar nonsense. Shared with GET /api/rates/history so
  // the two routes cannot disagree about what a valid pair is.
  if (!isValidCombination(metal as Metal, purity as Purity)) {
    return errorJson(`${purity} is not a valid purity for ${metal}.`, 400);
  }

  try {
    // Rupees → paise → per-gram. Rounded once, here, before it becomes an integer.
    const displayPaise = BigInt(Math.round(displayRupees * 100));
    const ratePerGram = fromDisplayUnit(metal as Metal, displayPaise);

    if (ratePerGram <= 0n) {
      return errorJson('That rate is too small to store.', 400);
    }

    const result = await setRate({
      metal: metal as Metal,
      purity: purity as Purity,
      ratePerGram,
      userId: admin.id,
      ip: await clientIp(),
      confirmed,
    });

    if (!result.ok) {
      // 409, with both values, so the admin UI can name the old and new figures in the
      // confirmation step (§7.3) rather than asking "are you sure?" about nothing.
      return json(
        {
          error: 'That is a large change. Confirm to continue.',
          needsConfirmation: true,
          previousPerGram: result.previous.toString(),
          changePct: Number((result.changePct * 100).toFixed(2)),
        },
        409,
      );
    }

    return json({ saved: true, ratePerGram: result.ratePerGram.toString() }, 201);
  } catch (err) {
    return serverError(err, 'admin/rates');
  }
}
