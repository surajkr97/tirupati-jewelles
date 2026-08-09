/**
 * Ranked product search for the admin catalogue list.
 * Created by Phase 9 (DEBT-023). Indexes from Phase 6 §6.4.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE QUERY IS PARAMETERISED. NOTHING THE ADMIN TYPES IS INTERPOLATED.
 *
 *  Same rule as `lib/catalog/search.ts`, restated because this is the second place in the
 *  application that uses `$queryRaw` for real work: every user value is a `${}` placeholder
 *  inside Prisma's TAGGED TEMPLATE, which sends it as a bound parameter. `Prisma.sql`,
 *  `$queryRawUnsafe` and string concatenation are not used here and must not be introduced.
 *
 *  `websearch_to_tsquery` rather than `to_tsquery`, for the same reason: `to_tsquery`
 *  throws on `gold &` or `ring!`, turning a typo into a 500.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is not a flag on the storefront's search ──
 * `searchProducts` hard-codes `p."isActive" = true AND c."isActive" = true` in the WHERE
 * clause, and §6 SECURITY depends on that being unreachable: "a filter the database applies
 * cannot be forgotten by a caller." The admin list needs the opposite — §7.4 shows hidden
 * pieces, because the screen whose job is to manage them must be able to find them. Adding
 * an `includeInactive` parameter would turn a structural guarantee into an argument one
 * call site could get wrong, on the one control that keeps soft-deleted stock off the
 * storefront. Two queries that cannot be confused beat one that can.
 *
 * ── Why only IDs ──
 * Ranking is the part SQL must do; filtering by category and status, and selecting columns,
 * is expressible in Prisma and stays there. So this returns ranked IDs and the caller
 * intersects them with its own filters — the same two-step `searchProducts` uses.
 */
import 'server-only';

import { db } from '@/lib/db';

/** The admin list renders at most 100 rows; ranking more would be ranking what is not shown. */
export const ADMIN_SEARCH_LIMIT = 100;

/** Matches the input cap on the admin form, so an oversized query is truncated, not refused. */
export const MAX_ADMIN_QUERY_LENGTH = 80;

interface MatchRow {
  id: string;
}

/**
 * Product IDs matching `query`, best first.
 *
 * Three ways to match, unioned by rank and mirroring §6.4 so an admin and a customer
 * searching the same words see the same order:
 *
 *   1. Full-text over the weighted `name`/`description` vector (`Product_search_idx`).
 *   2. Trigram similarity on the name (`Product_name_trgm_idx`), so a half-typed "neckl"
 *      still finds "Necklace" — full-text cannot do prefixes.
 *   3. A category-name match, joined at query time rather than denormalised, so renaming a
 *      collection takes effect immediately.
 *
 * Unlike the storefront's, this sees inactive products AND products in inactive categories.
 * Returns `[]` for an empty query — the caller should skip the ID filter entirely rather
 * than filtering to nothing.
 */
export async function rankedAdminProductIds(rawQuery: string): Promise<string[]> {
  const query = rawQuery.trim().slice(0, MAX_ADMIN_QUERY_LENGTH);
  if (query === '') return [];

  const like = `%${query}%`;

  const rows = await db.$queryRaw<MatchRow[]>`
    SELECT p."id",
           GREATEST(
             ts_rank(
               setweight(to_tsvector('english', coalesce(p."name", '')), 'A') ||
               setweight(to_tsvector('english', coalesce(p."description", '')), 'B'),
               websearch_to_tsquery('english', ${query})
             ),
             similarity(p."name", ${query}),
             CASE WHEN c."name" ILIKE ${like} THEN 0.2 ELSE 0 END
           ) AS rank
    FROM "Product" p
    JOIN "Category" c ON c."id" = p."categoryId"
    WHERE (
        (
          setweight(to_tsvector('english', coalesce(p."name", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(p."description", '')), 'B')
        ) @@ websearch_to_tsquery('english', ${query})
        OR p."name" ILIKE ${like}
        OR c."name" ILIKE ${like}
      )
    ORDER BY rank DESC, p."createdAt" DESC
    LIMIT ${ADMIN_SEARCH_LIMIT}
  `;

  return rows.map((row) => row.id);
}
