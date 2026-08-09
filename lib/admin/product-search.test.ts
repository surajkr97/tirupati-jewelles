/**
 * Phase 9 TEST — the admin catalogue search ranks, and sees what the storefront must not.
 * DEBT-023.
 *
 * A real Postgres: the behaviour under test IS the database's — a weighted tsvector, a
 * trigram similarity and a join. There is nothing left to test if those are mocked.
 */
import { Metal, Purity } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { rankedAdminProductIds } from '@/lib/admin/product-search';
import { db } from '@/lib/db';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

let ringsId: string;
let hiddenCategoryId: string;

async function seed(
  name: string,
  description: string,
  options: { isActive?: boolean; categoryId?: string } = {},
) {
  const product = await db.product.create({
    data: {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description,
      categoryId: options.categoryId ?? ringsId,
      metal: Metal.GOLD,
      purity: Purity.K22_916,
      weightMg: 5000,
      makingPct: 12,
      stoneCharge: 0n,
      isActive: options.isActive ?? true,
    },
    select: { id: true, name: true },
  });
  return product;
}

/** Resolve IDs back to names, so a failure reads as an ordering rather than as UUIDs. */
async function names(ids: string[]): Promise<string[]> {
  const rows = await db.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return ids.map((id) => byId.get(id) ?? '?');
}

describeDb('admin product search', () => {
  beforeEach(async () => {
    await db.productImage.deleteMany();
    await db.product.deleteMany();
    await db.category.deleteMany();

    const rings = await db.category.create({
      data: { name: 'Rings', slug: 'rings', sortOrder: 0 },
      select: { id: true },
    });
    ringsId = rings.id;

    const hidden = await db.category.create({
      data: { name: 'Mangalsutra', slug: 'mangalsutra', sortOrder: 1, isActive: false },
      select: { id: true },
    });
    hiddenCategoryId = hidden.id;
  });

  afterAll(async () => {
    await db.productImage.deleteMany();
    await db.product.deleteMany();
    await db.category.deleteMany();
  });

  it('returns nothing for an empty query, so the caller filters on nothing', async () => {
    await seed('Gold ring', 'A plain band');

    expect(await rankedAdminProductIds('')).toEqual([]);
    expect(await rankedAdminProductIds('   ')).toEqual([]);
  });

  it('ranks a name match above a description-only match', async () => {
    await seed('Temple necklace', 'A heavy piece');
    await seed('Plain band', 'Pairs well with a necklace');

    const ranked = await names(await rankedAdminProductIds('necklace'));

    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toBe('Temple necklace');
  });

  /**
   * The one behaviour that differs from the storefront, and the reason this is a separate
   * query rather than a flag on `searchProducts`. §7.4: "a soft-deleted piece the admin
   * cannot find is a piece they cannot bring back."
   */
  it('finds a hidden piece, which the storefront search must never return', async () => {
    await seed('Retired jhumka', 'Discontinued', { isActive: false });

    const ranked = await names(await rankedAdminProductIds('jhumka'));
    expect(ranked).toEqual(['Retired jhumka']);

    const { searchProducts } = await import('@/lib/catalog/search');
    const storefront = await searchProducts('jhumka');
    expect(storefront.products).toEqual([]);
  });

  it('finds a piece in a hidden collection too', async () => {
    await seed('Long mangalsutra', 'Two-line', { categoryId: hiddenCategoryId });

    expect(await names(await rankedAdminProductIds('mangalsutra'))).toContain(
      'Long mangalsutra',
    );
  });

  it('matches a prefix, which `contains` could do but ranking could not', async () => {
    // The trigram index is what makes this work — the one a migration dropped.
    await seed('Kundan necklace', 'Bridal');

    expect(await names(await rankedAdminProductIds('neckl'))).toEqual([
      'Kundan necklace',
    ]);
  });

  it('matches by collection name, which `contains` on the product name could not', async () => {
    await seed('Untitled piece 1', 'No helpful words here');

    expect(await names(await rankedAdminProductIds('rings'))).toEqual([
      'Untitled piece 1',
    ]);
  });

  it('is case-insensitive, as the `contains` filter was', async () => {
    await seed('Gold Ring', 'Plain');

    expect(await rankedAdminProductIds('GOLD')).toHaveLength(1);
    expect(await rankedAdminProductIds('gold')).toHaveLength(1);
  });

  /**
   * §6 SECURITY's rule, restated for the second `$queryRaw` in the codebase. `to_tsquery`
   * would throw a syntax error on most of these and turn a typo into a 500; the point of
   * `websearch_to_tsquery` is that it never does.
   */
  it('treats hostile and malformed input as text, not as SQL', async () => {
    await seed('Gold ring', 'Plain');

    for (const hostile of [
      '\'; DROP TABLE "Product"; --',
      'gold &',
      'ring!',
      "1' OR '1'='1",
      '%',
      '\\',
      'a'.repeat(500),
    ]) {
      await expect(rankedAdminProductIds(hostile)).resolves.toBeInstanceOf(Array);
    }

    // The table is still there, which is the assertion that matters.
    expect(await db.product.count()).toBe(1);
  });
});
