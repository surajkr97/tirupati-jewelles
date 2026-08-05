/**
 * POST /api/calculator/share — store an item set, return a short slug.
 * Created by Phase 5 (specs/05-calculator.md §5.5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  This is a PUBLIC WRITE endpoint — the only one in the application that lets an
 *  unauthenticated caller create a database row. Two controls follow from that:
 *
 *    1. It is rate limited per IP. Without that, a loop fills the table.
 *    2. It stores ITEMS ONLY. The rates are read from the server at this moment and the
 *       totals are computed at render time. §5: "A client-submitted total is display-only
 *       and is discarded on arrival" — there is no field for one, and `.strict()` makes an
 *       attempt an error rather than a silent drop.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { consume } from '@/lib/auth/rate-limit';
import { shareRequestSchema } from '@/lib/calculator/schema';
import { createShare } from '@/lib/calculator/share';
import {
  clientIp,
  errorJson,
  json,
  parseBody,
  requireSameOrigin,
  serverError,
} from '@/lib/http';
import { getCurrentRates, newestEffectiveAt, toRatesByPurity } from '@/lib/rates';

export const dynamic = 'force-dynamic';

/**
 * 20 shares per IP per hour.
 *
 * Generous for the real use — a customer shares a quote once, a shop assistant maybe a
 * dozen times a day — and low enough that filling the table takes effort. Unlike the OTP
 * limiter this one is allowed to fail closed on a Redis fault (`consume` does that for
 * every caller): losing the share button during an outage is a far smaller problem than an
 * unbounded public insert.
 */
const SHARE_LIMIT = { limit: 20, windowSeconds: 60 * 60 };

export async function POST(request: Request) {
  // CSRF: reject a cross-origin state change (Phase 7 §7 SECURITY).
  const crossOrigin = await requireSameOrigin();
  if (crossOrigin) return crossOrigin;

  const parsed = await parseBody(request, shareRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const ip = await clientIp();
    const limit = await consume({ key: `calc:share:ip:${ip}`, ...SHARE_LIMIT });

    if (!limit.allowed) {
      return errorJson('Too many shared links. Try again later.', 429, {
        retryAfter: limit.retryAfter,
      });
    }

    /**
     * The rate snapshot. Read from the server here, never accepted from the caller —
     * MASTER-SPEC's price-tampering control is "Client never sends a rate", and a share
     * link carrying its own rates would be a way to publish any price under the shop's
     * domain.
     */
    const rates = await getCurrentRates();

    const share = await createShare(
      parsed.data.items,
      toRatesByPurity(rates),
      newestEffectiveAt(rates),
    );

    return json(
      {
        slug: share.slug,
        path: `/calculator/s/${share.slug}`,
        expiresAt: share.expiresAt.toISOString(),
      },
      201,
    );
  } catch (err) {
    return serverError(err, 'api/calculator/share');
  }
}
