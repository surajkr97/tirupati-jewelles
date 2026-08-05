/**
 * GET /api/rates/history — public rate history for one metal/purity.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.2).
 *
 * `?metal=&purity=&days=` — the sparkline's data as a public endpoint. Like `/api/rates`
 * this serves the TRUE rate only; the jitter has no path to a server.
 *
 * Read-only over a table the admin already publishes on `/rates`, so there is nothing here
 * to authorise. It is still fully validated: an unbounded `days` is a free full-table scan
 * for anyone who can spell the URL.
 */
import { Metal, Purity } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { errorJson, parseQuery, serverError } from '@/lib/http';
import { getRateHistory, isValidCombination, unitLabel } from '@/lib/rates';

export const dynamic = 'force-dynamic';

/** The `/rates` page asks for 30; the ceiling stops a scan of the whole table. */
export const MAX_HISTORY_DAYS = 365;
export const DEFAULT_HISTORY_DAYS = 7;

/**
 * Query values are always strings, so `days` has to become a number somewhere. It is parsed
 * with an explicit digits-only regex rather than `z.coerce.number()`: SECURITY requires
 * "reject, don't coerce", and coercion would quietly turn `''` into 0, `true` into 1 and
 * `1e9` into a billion.
 */
const historyQuerySchema = z.object({
  metal: z.enum(Metal),
  purity: z.enum(Purity),
  days: z
    .string()
    .regex(/^\d{1,3}$/, 'days must be a whole number')
    .transform(Number)
    .refine((n) => n >= 1 && n <= MAX_HISTORY_DAYS, `days must be 1–${MAX_HISTORY_DAYS}`)
    .optional()
    .default(DEFAULT_HISTORY_DAYS),
});

export async function GET(request: Request) {
  const parsed = parseQuery(request, historyQuerySchema);
  if (!parsed.ok) return parsed.response;

  const { metal, purity, days } = parsed.data;

  // A well-formed request for a rate that cannot exist — GOLD/SILVER_999 — is a 400, not
  // an empty 200. An empty list would read as "no history yet" and hide the typo.
  if (!isValidCombination(metal, purity)) {
    return errorJson(`${purity} is not a valid purity for ${metal}.`, 400);
  }

  try {
    const points = await getRateHistory(metal, purity, days);

    return NextResponse.json(
      {
        metal,
        purity,
        unit: unitLabel(metal),
        days,
        // Display-unit paise as strings — bigint is not JSON-serialisable, and Number
        // would reintroduce float money (MASTER-SPEC §4).
        points: points.map((point) => ({ at: point.at, rate: point.rate.toString() })),
      },
      {
        headers: {
          // Same shared-cache window as /api/rates (§4.2); history only changes when the
          // admin sets a rate, which busts `rates:current` in the same breath.
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        },
      },
    );
  } catch (err) {
    return serverError(err, 'api/rates/history');
  }
}
