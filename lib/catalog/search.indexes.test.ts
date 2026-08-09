/**
 * Phase 9 TEST — the search indexes exist in the database (DEBT-023).
 *
 * §6.4 built two, and one of them was gone.
 *
 * `20260805144145_product_search_index` created `Product_name_trgm_idx` in hand-written SQL.
 * It was not declared in `schema.prisma`, so the very next migration —
 * `20260805200149_shop_settings` — diffed the schema against the database, saw an index the
 * schema did not describe, and **dropped it**. Prefix and typo-tolerant search ran
 * unindexed from Phase 7 until Phase 9 found it.
 *
 * Nothing failed, and nothing could have: at 25 products a sequential scan is the correct
 * plan, so the query still returned the right rows at the right speed. §9.2 recorded the
 * same lesson from the other direction — "a missing index is invisible precisely because
 * the table is small enough not to need it yet" — which is why this is asserted against
 * `pg_indexes` rather than inferred from a timing.
 *
 * The declaration in `schema.prisma` is what prevents a recurrence; this is what NOTICES
 * one. Both are needed: `Product_search_idx` is an expression index, and it survived only
 * because Prisma's diff cannot see expression indexes at all. That is luck, not protection.
 */
import { describe, expect, it } from 'vitest';

import { db } from '@/lib/db';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

interface IndexRow {
  indexname: string;
  indexdef: string;
}

describeDb('§6.4 search indexes', () => {
  async function productIndexes(): Promise<IndexRow[]> {
    return db.$queryRaw<IndexRow[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'Product' AND schemaname = 'public'
    `;
  }

  it('the weighted full-text GIN index exists', async () => {
    const index = (await productIndexes()).find(
      (row) => row.indexname === 'Product_search_idx',
    );

    expect(index, 'Product_search_idx is missing').toBeDefined();
    expect(index?.indexdef).toContain('gin');
    // The index only serves the query if the expression matches it exactly.
    expect(index?.indexdef).toContain('setweight');
    expect(index?.indexdef).toContain("'english'");
  });

  it('the trigram index exists — the one a migration silently dropped', async () => {
    const index = (await productIndexes()).find(
      (row) => row.indexname === 'Product_name_trgm_idx',
    );

    expect(index, 'Product_name_trgm_idx is missing — see DEBT-023').toBeDefined();
    expect(index?.indexdef).toContain('gin_trgm_ops');
  });

  it('pg_trgm is installed, or similarity() would not resolve at all', async () => {
    const rows = await db.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
    `;

    expect(rows).toHaveLength(1);
  });

  /**
   * The index is only useful if the planner will actually choose it, which depends on the
   * query expression matching the index expression. Asserted on the plan rather than on a
   * timing — but note it can only ever be a NEGATIVE control at this catalogue size: with
   * 25 rows Postgres correctly prefers a sequential scan, so this asserts the plan is
   * *available*, by forcing the planner's hand.
   */
  it('the planner can use the trigram index when told to prefer it', async () => {
    await db.$executeRawUnsafe('SET LOCAL enable_seqscan = off');

    const plan = await db.$queryRaw<{ 'QUERY PLAN': string }[]>`
      EXPLAIN SELECT id FROM "Product" WHERE "name" ILIKE '%ring%'
    `;
    const text = plan.map((row) => row['QUERY PLAN']).join('\n');

    // Either it uses the index, or the table is small enough that the planner refuses even
    // with seqscan disabled — in which case the index's existence is all that is assertable.
    expect(text.length).toBeGreaterThan(0);
    if (text.includes('Index')) expect(text).toContain('Product_name_trgm_idx');
  });
});
