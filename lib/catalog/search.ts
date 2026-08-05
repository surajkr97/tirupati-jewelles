/**
 * Catalogue search.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE QUERY IS PARAMETERISED. NOTHING THE USER TYPES IS INTERPOLATED.
 *
 *  §6 SECURITY: "Search input parameterised — no SQL injection via the query string."
 *
 *  This is the one place in the application that uses `$queryRaw` for real work, so the
 *  rule needs stating plainly: every user value is a `${}` placeholder inside Prisma's
 *  TAGGED TEMPLATE, which sends it as a bound parameter. `Prisma.sql`/`$queryRawUnsafe`
 *  and string concatenation are not used here and must not be introduced.
 *
 *  `websearch_to_tsquery` rather than `to_tsquery` is part of that: `to_tsquery` throws a
 *  syntax error on input like `gold &` or `ring!`, which turns an ordinary typo into a 500.
 *  `websearch_to_tsquery` parses the way a search box user expects and never throws.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import type { CatalogFilters } from '@/lib/catalog/filters';
import {
  PRODUCT_CARD_SELECT,
  priceProduct,
  type PricedProduct,
} from '@/lib/catalog/products';
import { db } from '@/lib/db';
import { getCurrentRates, toRatesByPurity } from '@/lib/rates';
import { cached } from '@/lib/redis';

/** §6.4: "results cached in Redis 300s". */
export const SEARCH_CACHE_TTL = 300;

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;
export const SEARCH_LIMIT = 24;

/** Normalise so `  Gold   Ring ` and `gold ring` share a cache entry. */
export function normaliseQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
}

export interface SearchResult {
  products: PricedProduct[];
  query: string;
  /** True when the query was too short to run. */
  tooShort: boolean;
}

interface MatchRow {
  id: string;
}

/**
 * Search active products by name, description and category name.
 *
 * Two passes, unioned by rank:
 *
 *   1. Full-text over the weighted `name`/`description` vector, matching the GIN index the
 *      `product_search_index` migration creates.
 *   2. Trigram similarity on the name, so a half-typed "neckl" still finds "Necklace".
 *      Full-text alone cannot do prefixes, and a search box user is mid-word on every
 *      keystroke.
 *
 * Category is matched by joining rather than denormalising into the index, so renaming a
 * category takes effect immediately instead of leaving its products mis-indexed.
 */
async function runSearch(query: string): Promise<string[]> {
  const rows = await db.$queryRaw<MatchRow[]>`
    SELECT p."id",
           GREATEST(
             ts_rank(
               setweight(to_tsvector('english', coalesce(p."name", '')), 'A') ||
               setweight(to_tsvector('english', coalesce(p."description", '')), 'B'),
               websearch_to_tsquery('english', ${query})
             ),
             similarity(p."name", ${query}),
             CASE WHEN c."name" ILIKE ${'%' + query + '%'} THEN 0.2 ELSE 0 END
           ) AS rank
    FROM "Product" p
    JOIN "Category" c ON c."id" = p."categoryId"
    WHERE p."isActive" = true
      AND c."isActive" = true
      AND (
        (
          setweight(to_tsvector('english', coalesce(p."name", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(p."description", '')), 'B')
        ) @@ websearch_to_tsquery('english', ${query})
        OR p."name" ILIKE ${'%' + query + '%'}
        OR c."name" ILIKE ${'%' + query + '%'}
      )
    ORDER BY rank DESC, p."createdAt" DESC
    LIMIT ${SEARCH_LIMIT}
  `;

  return rows.map((row) => row.id);
}

/**
 * Search, cached.
 *
 * The cache holds only the matching IDs, not the priced products. Prices move with the
 * rate, and a cached price would be a stale price on a product card — the one thing
 * MASTER-SPEC §8 is most careful about. IDs are stable for as long as the catalogue is, so
 * this caches the expensive part and recomputes the part that must be current.
 */
export async function searchProducts(rawQuery: string): Promise<SearchResult> {
  const query = normaliseQuery(rawQuery);

  if (query.length < MIN_QUERY_LENGTH) {
    return { products: [], query, tooShort: true };
  }

  // Lower-cased in the key only — the search itself is already case-insensitive, and this
  // stops `Gold` and `gold` occupying two entries.
  const ids = await cached(`search:${query.toLowerCase()}`, SEARCH_CACHE_TTL, () =>
    runSearch(query),
  );

  if (ids.length === 0) return { products: [], query, tooShort: false };

  const [rows, rates] = await Promise.all([
    db.product.findMany({
      where: { id: { in: ids }, isActive: true },
      select: PRODUCT_CARD_SELECT,
    }),
    getCurrentRates().then(toRatesByPurity),
  ]);

  // `IN` does not preserve order, and the ranking is the whole value of the search.
  const order = new Map(ids.map((id, index) => [id, index]));
  const sorted = [...rows].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );

  return {
    products: sorted.map((row) => priceProduct(row, rates)),
    query,
    tooShort: false,
  };
}

/** Filters are not applied to search results; this keeps the type honest at the call site. */
export type SearchFilters = Pick<CatalogFilters, 'sort'>;
