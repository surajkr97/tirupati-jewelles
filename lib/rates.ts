/**
 * Rate service — the true rate.
 * Created by Phase 4 (specs/04-rates-ticker.md §4.1). Units from MASTER-SPEC §4.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Two rate values exist in this system and they must never be confused.
 *
 *    TRUE rate     — this file. Calculator, bills, product prices. Anything with money.
 *    DISPLAY rate  — true rate ± jitter, client-side only, RateTicker.tsx, nothing else.
 *
 *  Nothing in this module knows the jitter exists. That is the architectural enforcement
 *  §4 asks for: the jitter lives in one component's React state and has no path back here.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything is PAISE PER GRAM as an integer. Display units are derived at the edge.
 */
import 'server-only';

import { Metal, Purity } from '@prisma/client';
import { revalidateTag } from 'next/cache';

import { db } from '@/lib/db';
import { cached, invalidate, redis } from '@/lib/redis';

export const RATES_CACHE_KEY = 'rates:current';
export const RATES_CACHE_TTL = 300;
export const RATES_TAG = 'rates';

/** A rate more than this far from the previous one needs `confirmed: true` (§4.2). */
export const SANITY_THRESHOLD = 0.2;

// ── Unit conversion — the ONLY place it happens (§4.1) ─────────────────────

/** Gold is quoted per 10 grams. */
export function perGramToPer10g(paisePerGram: bigint): bigint {
  return paisePerGram * 10n;
}

/** Silver is quoted per kilogram. */
export function perGramToPerKg(paisePerGram: bigint): bigint {
  return paisePerGram * 1000n;
}

/**
 * Admin input is in the display unit (§4.2) — the shop thinks in ₹/10g and ₹/kg.
 *
 * Integer division truncates, so a per-10g value that is not a multiple of 10 paise loses
 * the remainder. At ₹1,18,420 per 10g that is a sub-paise rounding on the per-gram rate,
 * far below the display precision, and it keeps the stored value exact rather than
 * introducing a float.
 */
export function per10gToPerGram(paisePer10g: bigint): bigint {
  return paisePer10g / 10n;
}

export function perKgToPerGram(paisePerKg: bigint): bigint {
  return paisePerKg / 1000n;
}

// ── Shape ──────────────────────────────────────────────────────────────────

export interface RateFace {
  perGram: bigint;
  /** Display unit: per 10g for gold, per kg for silver. */
  display: bigint;
  effectiveAt: string;
  /** Change against the previous recorded rate, in the display unit. */
  change: bigint;
}

export interface Rates {
  gold22: RateFace;
  gold18: RateFace;
  silver999: RateFace;
}

export const RATE_FACES = [
  { key: 'gold22', metal: Metal.GOLD, purity: Purity.K22_916, unit: 'per 10 grams' },
  { key: 'gold18', metal: Metal.GOLD, purity: Purity.K18_750, unit: 'per 10 grams' },
  {
    key: 'silver999',
    metal: Metal.SILVER,
    purity: Purity.SILVER_999,
    unit: 'per 1 kilogram',
  },
] as const;

export type RateKey = (typeof RATE_FACES)[number]['key'];

export function toDisplayUnit(metal: Metal, perGram: bigint): bigint {
  return metal === Metal.GOLD ? perGramToPer10g(perGram) : perGramToPerKg(perGram);
}

export function fromDisplayUnit(metal: Metal, display: bigint): bigint {
  return metal === Metal.GOLD ? per10gToPerGram(display) : perKgToPerGram(display);
}

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * Current rates, cache-aside on `rates:current` (MASTER-SPEC §7).
 *
 * `cached()` never throws, so a Redis outage falls through to Postgres and the page is
 * slower rather than broken — Phase 9 §9.5 verifies that by killing Redis.
 */
export async function getCurrentRates(): Promise<Rates> {
  return cached(RATES_CACHE_KEY, RATES_CACHE_TTL, loadRatesFromDb);
}

async function loadRatesFromDb(): Promise<Rates> {
  const entries = await Promise.all(
    RATE_FACES.map(async ({ key, metal, purity }) => {
      // Two rows: the current rate and the one before it, for the delta.
      const rows = await db.metalRate.findMany({
        where: { metal, purity },
        orderBy: { effectiveAt: 'desc' },
        take: 2,
        select: { ratePerGram: true, effectiveAt: true },
      });

      const current = rows[0];
      const previous = rows[1];

      const perGram = current?.ratePerGram ?? 0n;
      const display = toDisplayUnit(metal, perGram);
      const previousDisplay = previous
        ? toDisplayUnit(metal, previous.ratePerGram)
        : display;

      return [
        key,
        {
          perGram,
          display,
          effectiveAt: (current?.effectiveAt ?? new Date(0)).toISOString(),
          change: display - previousDisplay,
        } satisfies RateFace,
      ] as const;
    }),
  );

  return Object.fromEntries(entries) as unknown as Rates;
}

export interface HistoryPoint {
  rate: bigint;
  at: string;
}

/** Sparkline data (§4.1). Reads Postgres — the Redis sorted set is a Phase 9 rollup. */
export async function getRateHistory(
  metal: Metal,
  purity: Purity,
  days = 7,
): Promise<HistoryPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.metalRate.findMany({
    where: { metal, purity, effectiveAt: { gte: since } },
    orderBy: { effectiveAt: 'asc' },
    select: { ratePerGram: true, effectiveAt: true },
  });

  return rows.map((row) => ({
    rate: toDisplayUnit(metal, row.ratePerGram),
    at: row.effectiveAt.toISOString(),
  }));
}

// ── Write ──────────────────────────────────────────────────────────────────

export interface SetRateInput {
  metal: Metal;
  purity: Purity;
  /** PAISE per gram. Callers convert from the display unit before calling. */
  ratePerGram: bigint;
  userId: string;
  ip?: string;
  /** Required to accept a change beyond ±20% (§4.2). */
  confirmed?: boolean;
}

export type SetRateResult =
  | { ok: true; ratePerGram: bigint }
  | { ok: false; reason: 'needs_confirmation'; previous: bigint; changePct: number };

/**
 * Record a new rate.
 *
 * Always an INSERT, never an update (§4.1) — the table is an audit trail, and Phase 8
 * bills snapshot from it. Rewriting history would change what a past bill says.
 */
export async function setRate(input: SetRateInput): Promise<SetRateResult> {
  const { metal, purity, ratePerGram, userId, ip, confirmed = false } = input;

  const previous = await db.metalRate.findFirst({
    where: { metal, purity },
    orderBy: { effectiveAt: 'desc' },
    select: { ratePerGram: true },
  });

  /**
   * Sanity guard (§4.2): "A fat-fingered extra zero on a gold rate is the most damaging
   * typo available in this app." It would flow straight into every product page and every
   * bill generated before someone noticed.
   */
  if (previous && previous.ratePerGram > 0n && !confirmed) {
    const before = Number(previous.ratePerGram);
    const changePct = Math.abs(Number(ratePerGram) - before) / before;

    if (changePct > SANITY_THRESHOLD) {
      return {
        ok: false,
        reason: 'needs_confirmation',
        previous: previous.ratePerGram,
        changePct,
      };
    }
  }

  await db.$transaction(async (tx) => {
    await tx.metalRate.create({
      data: { metal, purity, ratePerGram, setByUserId: userId },
    });

    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'RATE_SET',
        entity: 'MetalRate',
        entityId: `${metal}:${purity}`,
        before: previous ? { ratePerGram: previous.ratePerGram.toString() } : undefined,
        after: { ratePerGram: ratePerGram.toString() },
        ip,
      },
    });
  });

  // Bust the cache before revalidating, or the regenerated page reads a stale value.
  await invalidate(RATES_CACHE_KEY);
  await appendHistory(metal, purity, ratePerGram);

  /**
   * Next.js 16 changed the signature to `revalidateTag(tag, profile)` — the profile is
   * required (D-002). The phase files were written against Next 15's one-argument form.
   *
   * `'max'` invalidates every entry under the tag regardless of age, which is what a rate
   * change needs: a stale product price is wrong money on a customer's screen.
   */
  revalidateTag(RATES_TAG, 'max');

  return { ok: true, ratePerGram };
}

/** Sorted set for the sparkline (MASTER-SPEC §7). Best-effort; Postgres is the truth. */
async function appendHistory(metal: Metal, purity: Purity, rate: bigint): Promise<void> {
  try {
    const key = `rates:history:${metal}:${purity}`;
    await redis.zadd(key, Date.now(), `${Date.now()}:${rate.toString()}`);
    await redis.expire(key, 7 * 24 * 60 * 60);
  } catch {
    // A failed cache write must not fail the rate change.
  }
}
