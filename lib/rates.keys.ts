/**
 * The mapping between the rates API's face keys and the pricing engine's purities.
 * Created by Phase 5 (specs/05-calculator.md §5.4).
 *
 * A separate module from `lib/rates.ts` because that one is `server-only` and the
 * calculator is CSR (MASTER-SPEC §6) — the browser has to turn a `/api/rates` response
 * into engine input without dragging Prisma into the bundle.
 *
 * This is the ONLY place the two naming schemes meet. `gold22` is a display concern and
 * `K22_916` is the domain value; one translation table means they cannot drift.
 */
import type { PurityKey } from '@/lib/pricing';

export type RateFaceKey = 'gold22' | 'gold18' | 'silver999';

export const PURITY_BY_FACE: Record<RateFaceKey, PurityKey> = {
  gold22: 'K22_916',
  gold18: 'K18_750',
  silver999: 'SILVER_999',
};

export const FACE_BY_PURITY: Record<PurityKey, RateFaceKey> = {
  K22_916: 'gold22',
  K18_750: 'gold18',
  SILVER_999: 'silver999',
};

/** One face as `GET /api/rates` serialises it. Money crosses the wire as a string. */
export interface SerialisedRate {
  perGram: string;
  display: string;
  change: string;
  effectiveAt: string;
  unit: string;
}

export type SerialisedRates = Record<RateFaceKey, SerialisedRate>;

/**
 * `/api/rates` payload → paise per gram by purity.
 *
 * Returns null rather than a partial object on anything unexpected. A rate table with a
 * missing purity would price that metal at zero, and a customer quoted ₹0 for a silver
 * chain is worse than a calculator that says it cannot reach the server.
 *
 * `BigInt`, never `Number` — MASTER-SPEC §4.
 */
export function ratesByPurityFromApi(payload: unknown): Record<PurityKey, bigint> | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const record = payload as Record<string, unknown>;
  const rates = {} as Record<PurityKey, bigint>;

  for (const [face, purity] of Object.entries(PURITY_BY_FACE)) {
    const entry = record[face];
    if (typeof entry !== 'object' || entry === null) return null;

    const perGram = (entry as { perGram?: unknown }).perGram;
    if (typeof perGram !== 'string' || !/^\d+$/.test(perGram)) return null;

    rates[purity] = BigInt(perGram);
  }

  return rates;
}

/** The newest `effectiveAt` in a payload — "rates as of" on a shared result (§5.5). */
export function newestEffectiveAt(payload: SerialisedRates): string | null {
  const times = Object.values(payload)
    .map((face) => face.effectiveAt)
    .filter(
      (iso) => Number.isFinite(new Date(iso).getTime()) && new Date(iso).getTime() > 0,
    )
    .sort();

  return times.at(-1) ?? null;
}
