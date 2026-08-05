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
import { revalidatePath, revalidateTag } from 'next/cache';

import { db } from '@/lib/db';
import type { RatesByPurity } from '@/lib/pricing';
import { cached, invalidate, redis } from '@/lib/redis';

export const RATES_CACHE_KEY = 'rates:current';
export const RATES_CACHE_TTL = 300;
export const RATES_TAG = 'rates';

/** A rate more than this far from the previous one needs `confirmed: true` (§4.2). */
export const SANITY_THRESHOLD = 0.2;

/**
 * ISR'd routes that render a rate, invalidated whenever one changes.
 *
 * MASTER-SPEC §6 promises a rate change "appears without waiting for the ISR window", and
 * `revalidateTag` alone does not deliver that: Next 16 only invalidates entries that
 * carry the tag, applied via `fetch(next.tags)` or `cacheTag()` inside a `'use cache'`
 * function. These pages read Postgres directly and are cached by `export const
 * revalidate`, so nothing here is tagged and the tag call matches nothing.
 *
 * Measured rather than assumed: against a production build, setting a rate updated
 * `/api/rates` immediately while `/` and `/rates` kept serving the old figure for the full
 * 300s. `/` self-corrects after five minutes because the ticker refetches over SWR;
 * `/rates` is server-rendered with no client fetch, so it had no way to catch up at all.
 *
 * `/products/[slug]` is a dynamic segment, so it is revalidated with `type: 'page'` — that
 * form invalidates every product page at once, which is what a rate change needs. Added in
 * Phase 6, discharging the `@DEV:` note Phase 4 left against DEBT-014.
 */
export const RATE_SURFACES = ['/', '/rates', '/collections'] as const;

/**
 * Dynamic routes that render a price, revalidated by pattern rather than by path.
 *
 * `revalidatePath('/products/[slug]', 'page')` matches every product page. Listing them
 * individually would mean querying every active slug on every rate change, and missing one
 * means a wrong price on a customer's screen.
 */
export const RATE_SURFACE_PATTERNS = ['/products/[slug]', '/collections/[slug]'] as const;

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

/** The display unit label for a metal (MASTER-SPEC §4): ₹ per 10 g, ₹ per 1 kg. */
export function unitLabel(metal: Metal): string {
  return metal === Metal.GOLD ? 'per 10 grams' : 'per 1 kilogram';
}

export const RATE_FACES = [
  {
    key: 'gold22',
    metal: Metal.GOLD,
    purity: Purity.K22_916,
    label: 'Gold 22K',
    unit: unitLabel(Metal.GOLD),
  },
  {
    key: 'gold18',
    metal: Metal.GOLD,
    purity: Purity.K18_750,
    label: 'Gold 18K',
    unit: unitLabel(Metal.GOLD),
  },
  {
    key: 'silver999',
    metal: Metal.SILVER,
    purity: Purity.SILVER_999,
    label: 'Silver 999',
    unit: unitLabel(Metal.SILVER),
  },
] as const;

export type RateKey = (typeof RATE_FACES)[number]['key'];

/**
 * Which purities belong to which metal.
 *
 * Lives here rather than in a route because two routes now need it (`POST /api/admin/rates`
 * and `GET /api/rates/history`), and two copies of a validation table drift. `GOLD` +
 * `SILVER_999` is a well-formed request for a rate that cannot exist.
 */
export const VALID_COMBINATIONS: Record<Metal, readonly Purity[]> = {
  [Metal.GOLD]: [Purity.K22_916, Purity.K18_750],
  [Metal.SILVER]: [Purity.SILVER_999],
};

export function isValidCombination(metal: Metal, purity: Purity): boolean {
  return VALID_COMBINATIONS[metal].includes(purity);
}

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

/**
 * Rates in the shape the pricing engine takes (Phase 5 §5.1).
 *
 * Server-side callers — the share endpoint, and Phase 8's bill generator — go through here
 * rather than rebuilding the mapping. The browser has its own path in `lib/rates.keys.ts`,
 * because this module is `server-only`.
 */
export function toRatesByPurity(rates: Rates): RatesByPurity {
  return {
    K22_916: rates.gold22.perGram,
    K18_750: rates.gold18.perGram,
    SILVER_999: rates.silver999.perGram,
  };
}

/** The newest `effectiveAt` across the three faces — what a rate snapshot is dated by. */
export function newestEffectiveAt(rates: Rates): Date {
  const times = RATE_FACES.map((face) => new Date(rates[face.key].effectiveAt).getTime())
    .filter((time) => Number.isFinite(time) && time > 0)
    .sort((a, b) => a - b);

  // No rate has ever been set. `now` is the honest answer: the snapshot is of an empty
  // table taken at this moment, not of some rate from 1970.
  return new Date(times.at(-1) ?? Date.now());
}

export interface HistoryPoint {
  rate: bigint;
  at: string;
}

/**
 * Most rows any single history read will return.
 *
 * The table is append-only, so it only grows. An admin correcting the rate a few times a
 * day for a year is several thousand rows — and `GET /api/rates/history` is public and
 * unauthenticated, so without a ceiling the response size is set by how long the shop has
 * been trading. 500 points is far more than a 30-day table or a sparkline can render.
 */
export const MAX_HISTORY_POINTS = 500;

/** Sparkline data (§4.1). Reads Postgres — the Redis sorted set is a Phase 9 rollup. */
export async function getRateHistory(
  metal: Metal,
  purity: Purity,
  days = 7,
): Promise<HistoryPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.metalRate.findMany({
    where: { metal, purity, effectiveAt: { gte: since } },
    // Newest first so the cap drops the OLDEST points when the window is dense. Taking the
    // first 500 ascending would silently hide today's rate behind last month's.
    orderBy: { effectiveAt: 'desc' },
    take: MAX_HISTORY_POINTS,
    select: { ratePerGram: true, effectiveAt: true },
  });

  // Callers want chronological order; the sparkline draws left to right.
  return rows.reverse().map((row) => ({
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
   *
   * Kept because §4.1 asks for it and because Phase 6/7 will introduce genuinely tagged
   * data — but on its own it invalidates nothing today. The line below is what actually
   * refreshes the pages. See RATE_SURFACES.
   */
  revalidateTag(RATES_TAG, 'max');
  for (const path of RATE_SURFACES) revalidatePath(path);
  // `type: 'page'` is required for a path containing a dynamic segment, and is what makes
  // one call cover every product rather than one product.
  for (const pattern of RATE_SURFACE_PATTERNS) revalidatePath(pattern, 'page');

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
