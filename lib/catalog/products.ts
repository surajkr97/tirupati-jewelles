/**
 * Catalogue queries and live product pricing.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.1, §6.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Product prices are COMPUTED, never stored.
 *
 *  §6.2: "Live price block — computed server-side from the current true rate." Every
 *  figure on a product page comes from `lib/pricing.ts` applied to the rate in `MetalRate`
 *  at request time. There is no price column, so there is nothing to go stale.
 *
 *  That is also why price filtering and price sorting cannot be pushed into SQL — see
 *  `listProducts`.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import { Prisma } from '@prisma/client';

import type { CatalogFilters } from '@/lib/catalog/filters';
import { PAGE_SIZE } from '@/lib/catalog/filters';
import { db } from '@/lib/db';
import {
  calculateLine,
  type LineResult,
  type PurityKey,
  type RatesByPurity,
} from '@/lib/pricing';
import { getCurrentRates, toRatesByPurity } from '@/lib/rates';

/**
 * Ceiling on how many rows are priced in memory for one filtered view.
 *
 * Price is a function of the live rate, so a price filter or a price sort cannot be
 * expressed in SQL against a stored column. The honest options were a materialised price
 * refreshed on every rate change, or pricing the candidate set in the application. For a
 * jewellery shop with a catalogue in the low hundreds, the second is simpler and always
 * correct; the ceiling stops it degrading quietly if the catalogue ever grows past that.
 *
 * Tracked in DEBT — the fix, if it is ever needed, is a rate-derived `pricePaise` column
 * updated by the same `setRate` path that busts the caches.
 */
export const PRICE_SORT_CEILING = 500;

export const PRODUCT_CARD_SELECT = {
  id: true,
  name: true,
  slug: true,
  metal: true,
  purity: true,
  weightMg: true,
  makingPct: true,
  stoneCharge: true,
  isFeatured: true,
  createdAt: true,
  category: { select: { name: true, slug: true } },
  images: {
    select: { url: true, alt: true },
    orderBy: { sortOrder: Prisma.SortOrder.asc },
    take: 1,
  },
} satisfies Prisma.ProductSelect;

export type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_CARD_SELECT }>;

export interface PricedProduct {
  id: string;
  name: string;
  slug: string;
  purity: PurityKey;
  weightMg: number;
  categoryName: string;
  categorySlug: string;
  imageUrl: string | null;
  imageAlt: string | null;
  isFeatured: boolean;
  createdAt: Date;
  price: LineResult;
}

/** MASTER-SPEC §4 default; Phase 7 makes it admin-configurable. */
const GST_PCT = 3;

/**
 * Price one product row.
 *
 * `makingPct` arrives as a Prisma `Decimal`. `.toNumber()` is safe and lossless here — the
 * column is `Decimal(5,2)`, so at most 5 significant digits — and `calculateLine` snaps it
 * to integer basis points immediately, before any money is touched.
 */
export function priceProduct(row: ProductRow, rates: RatesByPurity): PricedProduct {
  const purity = row.purity as PurityKey;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    purity,
    weightMg: row.weightMg,
    categoryName: row.category.name,
    categorySlug: row.category.slug,
    imageUrl: row.images[0]?.url ?? null,
    imageAlt: row.images[0]?.alt ?? null,
    isFeatured: row.isFeatured,
    createdAt: row.createdAt,
    price: calculateLine(
      {
        metal: row.metal === 'SILVER' ? 'SILVER' : 'GOLD',
        purity,
        weightMg: row.weightMg,
        makingPct: row.makingPct.toNumber(),
        stoneCharge: row.stoneCharge,
        gstPct: GST_PCT,
      },
      rates[purity],
    ),
  };
}

export interface ProductListResult {
  products: PricedProduct[];
  /** Total matching the filters, across all pages. */
  total: number;
  hasMore: boolean;
  /** True when the result was clipped by PRICE_SORT_CEILING. */
  clipped: boolean;
}

/**
 * List products in a category, filtered, sorted and paginated.
 *
 * Purity and weight are filtered in SQL — both are stored columns. Price is not: it depends
 * on today's rate, so the candidate set is priced in memory and then filtered and sorted.
 * `PRICE_SORT_CEILING` bounds that work.
 *
 * Only ACTIVE products are ever returned. §6 SECURITY requires an inactive product to 404
 * on direct access, and the surest way to keep that true is for no listing query to be able
 * to surface one.
 */
export async function listProducts(
  categorySlug: string | null,
  filters: CatalogFilters,
): Promise<ProductListResult> {
  const rates = toRatesByPurity(await getCurrentRates());

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    ...(categorySlug ? { category: { slug: categorySlug, isActive: true } } : {}),
    ...(filters.purity ? { purity: filters.purity } : {}),
    ...(filters.weight
      ? {
          weightMg: {
            ...(filters.weight.min !== null ? { gte: Number(filters.weight.min) } : {}),
            // Bands are half-open, so 15 g belongs to `15-30` and not to `5-15`. Without
            // that a product on a boundary appears in two bands and the counts stop adding
            // up.
            ...(filters.weight.max !== null ? { lt: Number(filters.weight.max) } : {}),
          },
        }
      : {}),
  };

  const needsPricePass = filters.price !== null || filters.sort.startsWith('price_');

  // Sorts that SQL can do are done in SQL, so the common cases paginate properly.
  const orderBy: Prisma.ProductOrderByWithRelationInput =
    filters.sort === 'weight_asc'
      ? { weightMg: 'asc' }
      : filters.sort === 'weight_desc'
        ? { weightMg: 'desc' }
        : { createdAt: 'desc' };

  if (!needsPricePass) {
    const [rows, total] = await Promise.all([
      db.product.findMany({
        where,
        orderBy,
        select: PRODUCT_CARD_SELECT,
        take: PAGE_SIZE,
        skip: (filters.page - 1) * PAGE_SIZE,
      }),
      db.product.count({ where }),
    ]);

    return {
      products: rows.map((row) => priceProduct(row, rates)),
      total,
      hasMore: filters.page * PAGE_SIZE < total,
      clipped: false,
    };
  }

  // Price pass: fetch the candidates, price them, then filter and sort on the result.
  const candidates = await db.product.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: PRODUCT_CARD_SELECT,
    take: PRICE_SORT_CEILING + 1,
  });

  const clipped = candidates.length > PRICE_SORT_CEILING;
  const priced = candidates
    .slice(0, PRICE_SORT_CEILING)
    .map((row) => priceProduct(row, rates));

  const band = filters.price;
  const matching = band
    ? priced.filter(
        (product) =>
          (band.min === null || product.price.lineTotal >= band.min) &&
          (band.max === null || product.price.lineTotal < band.max),
      )
    : priced;

  const sorted = [...matching].sort((a, b) => {
    if (filters.sort === 'price_asc')
      return compareBigInt(a.price.lineTotal, b.price.lineTotal);
    if (filters.sort === 'price_desc')
      return compareBigInt(b.price.lineTotal, a.price.lineTotal);
    if (filters.sort === 'weight_asc') return a.weightMg - b.weightMg;
    if (filters.sort === 'weight_desc') return b.weightMg - a.weightMg;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const start = (filters.page - 1) * PAGE_SIZE;

  return {
    products: sorted.slice(start, start + PAGE_SIZE),
    total: sorted.length,
    hasMore: start + PAGE_SIZE < sorted.length,
    clipped,
  };
}

/** `Array.sort` needs a number; bigint subtraction does not narrow to one. */
function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const PRODUCT_DETAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  metal: true,
  purity: true,
  weightMg: true,
  makingPct: true,
  stoneCharge: true,
  hasHallmark: true,
  hallmarkNo: true,
  bisCertNo: true,
  isActive: true,
  isFeatured: true,
  createdAt: true,
  category: { select: { name: true, slug: true } },
  images: {
    select: { id: true, url: true, alt: true },
    orderBy: { sortOrder: Prisma.SortOrder.asc },
  },
} satisfies Prisma.ProductSelect;

export type ProductDetailRow = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_DETAIL_SELECT;
}>;

export interface PricedProductDetail extends PricedProduct {
  description: string | null;
  makingPct: number;
  stoneCharge: bigint;
  hasHallmark: boolean;
  hallmarkNo: string | null;
  bisCertNo: string | null;
  ratePerGram: bigint;
  gstPct: number;
  images: { id: string; url: string; alt: string | null }[];
}

/**
 * One product by slug, priced — or null.
 *
 * `isActive: true` is in the WHERE clause, not checked after the fetch. §6 SECURITY:
 * "Inactive products return 404 on direct URL access." A filter the database applies cannot
 * be forgotten by a caller.
 */
export async function getProductBySlug(
  slug: string,
): Promise<PricedProductDetail | null> {
  if (typeof slug !== 'string' || slug.length === 0 || slug.length > 200) return null;

  const row = await db.product.findFirst({
    where: { slug, isActive: true, category: { isActive: true } },
    select: PRODUCT_DETAIL_SELECT,
  });
  if (!row) return null;

  const rates = toRatesByPurity(await getCurrentRates());
  const purity = row.purity as PurityKey;

  const base = priceProduct({ ...row, images: row.images.slice(0, 1) }, rates);

  return {
    ...base,
    description: row.description,
    makingPct: row.makingPct.toNumber(),
    stoneCharge: row.stoneCharge,
    hasHallmark: row.hasHallmark,
    hallmarkNo: row.hallmarkNo,
    bisCertNo: row.bisCertNo,
    ratePerGram: rates[purity],
    gstPct: GST_PCT,
    images: row.images,
  };
}

/** §6.2: "Related products from the same category." */
export async function getRelatedProducts(
  categorySlug: string,
  excludeSlug: string,
  limit = 4,
): Promise<PricedProduct[]> {
  const rates = toRatesByPurity(await getCurrentRates());

  const rows = await db.product.findMany({
    where: {
      isActive: true,
      category: { slug: categorySlug, isActive: true },
      slug: { not: excludeSlug },
    },
    // Featured first so the shop's own picks surface, then newest.
    orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: PRODUCT_CARD_SELECT,
  });

  return rows.map((row) => priceProduct(row, rates));
}

export async function listActiveCategories() {
  return db.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });
}

export async function getCategoryBySlug(slug: string) {
  return db.category.findFirst({
    where: { slug, isActive: true },
    select: { id: true, name: true, slug: true, imageUrl: true },
  });
}

/** Slugs for `generateStaticParams` (§6.1, §6.2). */
export async function activeCategorySlugs(): Promise<string[]> {
  const rows = await db.category.findMany({
    where: { isActive: true },
    select: { slug: true },
  });
  return rows.map((row) => row.slug);
}

export async function activeProductSlugs(): Promise<string[]> {
  const rows = await db.product.findMany({
    where: { isActive: true, category: { isActive: true } },
    select: { slug: true },
  });
  return rows.map((row) => row.slug);
}
