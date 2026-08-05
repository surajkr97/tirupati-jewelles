/**
 * Shareable calculator results.
 * Created by Phase 5 (specs/05-calculator.md §5.5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §5.5: "recomputes with rates snapshotted at share time, so a shared link doesn't
 *  silently change price."
 *
 *  This is the same principle as `OrderItem.ratePerGram` in MASTER-SPEC §5 — a quote you
 *  sent someone must not move under them. Gold moves daily; a link shared on Monday and
 *  opened on Friday would otherwise show a different total and make the shop look either
 *  careless or dishonest.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import { randomBytes } from 'node:crypto';

import { calculatorItemsSchema } from '@/lib/calculator/schema';
import type { CalculatorItem } from '@/lib/calculator/types';
import { db } from '@/lib/db';
import { PURITIES, type PurityKey, type RatesByPurity } from '@/lib/pricing';

/** §5.5: "30-day expiry." */
export const SHARE_TTL_DAYS = 30;

/**
 * Slug alphabet: no vowels (so it cannot spell anything), no `0/O` or `1/l/I`.
 * The link gets read aloud and typed by hand often enough for that to matter.
 */
const ALPHABET = '23456789bcdfghjkmnpqrstvwxyz';
const SLUG_LENGTH = 12;

/**
 * ~57 bits of entropy. The URL is the only thing guarding the link, exactly like a Phase 8
 * bill PDF key, so it must not be enumerable — MASTER-SPEC's risk table calls a guessable
 * one out by name.
 *
 * `randomBytes`, never `Math.random`: the latter is seeded predictably and is not a
 * security primitive.
 */
export function generateSlug(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let slug = '';
  for (const byte of bytes) {
    // Modulo bias is negligible here (256 % 28 = 4 of 28 symbols very slightly favoured)
    // and this is an unguessability budget, not a cryptographic key.
    slug += ALPHABET[byte % ALPHABET.length];
  }
  return slug;
}

export interface StoredShare {
  slug: string;
  items: CalculatorItem[];
  rates: RatesByPurity;
  ratesAt: Date;
  createdAt: Date;
  expiresAt: Date;
}

/** Serialise a rate snapshot for JSON storage — bigint is not JSON-serialisable. */
function ratesToJson(rates: RatesByPurity): Record<string, string> {
  return Object.fromEntries(PURITIES.map((p) => [p, rates[p].toString()]));
}

function ratesFromJson(raw: unknown): RatesByPurity | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const record = raw as Record<string, unknown>;
  const rates = {} as RatesByPurity;

  for (const purity of PURITIES) {
    const value = record[purity];
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    rates[purity as PurityKey] = BigInt(value);
  }
  return rates;
}

export async function createShare(
  items: CalculatorItem[],
  rates: RatesByPurity,
  ratesAt: Date,
): Promise<StoredShare> {
  const now = Date.now();
  const expiresAt = new Date(now + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);

  /**
   * Retry on the unique constraint rather than pre-checking with a SELECT.
   *
   * A check-then-insert is a race: two requests can both see the slug free. At 57 bits a
   * collision is vanishingly unlikely, so this loop should never run twice — but "should
   * never" is why it is three attempts and not one.
   */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = generateSlug();
    try {
      const row = await db.calculatorShare.create({
        data: {
          slug,
          items: items as unknown as object,
          rates: ratesToJson(rates),
          ratesAt,
          expiresAt,
        },
      });

      return {
        slug: row.slug,
        items,
        rates,
        ratesAt: row.ratesAt,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      };
    } catch (err) {
      const isCollision =
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'P2002';
      if (!isCollision) throw err;
    }
  }

  throw new Error('Could not allocate a share slug after 3 attempts.');
}

/**
 * Read a share, or null if it does not exist or has expired.
 *
 * Expired and missing are deliberately indistinguishable. Telling a caller "this link
 * expired" for slugs that once existed turns the endpoint into an oracle for which slugs
 * were ever real.
 *
 * The stored items are re-validated on the way out. They were validated on the way in, but
 * a row can outlive the shape that wrote it, and rendering an unvalidated JSON blob into a
 * price is exactly the shortcut that produces NaN in front of a customer.
 */
export async function readShare(slug: string): Promise<StoredShare | null> {
  if (!/^[a-z0-9]{1,32}$/.test(slug)) return null;

  const row = await db.calculatorShare.findUnique({ where: { slug } });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  const items = calculatorItemsSchema.safeParse(row.items);
  const rates = ratesFromJson(row.rates);
  if (!items.success || !rates) return null;

  return {
    slug: row.slug,
    items: items.data,
    rates,
    ratesAt: row.ratesAt,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
