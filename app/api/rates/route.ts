/**
 * GET /api/rates — public, the true rate.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.2).
 *
 * This is what the calculator reads. It is never the jittered display value — the jitter
 * exists only inside RateTicker's React state and has no route back to a server.
 */
import { NextResponse } from 'next/server';

import { getCurrentRates, RATE_FACES } from '@/lib/rates';
import { serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rates = await getCurrentRates();

    // bigint is not JSON-serialisable, so every money field crosses the wire as a string.
    // The client parses it back with BigInt() — never as a Number, which would lose
    // precision on large values and reintroduce float money.
    const body = Object.fromEntries(
      RATE_FACES.map(({ key, unit }) => {
        const face = rates[key];
        return [
          key,
          {
            perGram: face.perGram.toString(),
            display: face.display.toString(),
            change: face.change.toString(),
            effectiveAt: face.effectiveAt,
            unit,
          },
        ];
      }),
    );

    return NextResponse.json(body, {
      headers: {
        // §4.2 — shared cache for the ISR window; the browser always revalidates.
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    return serverError(err, 'api/rates');
  }
}
