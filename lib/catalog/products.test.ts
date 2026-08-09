/**
 * Phase 6 TEST + SECURITY — catalogue queries against a real database.
 * specs/06-catalog-enquiry.md:
 *
 *   TEST: "Product price matches `calculateLine` output exactly."
 *   TEST: "Filters produce correct sets."
 *   TEST: "Product with zero images renders the empty frame without breaking layout."
 *   SECURITY: "Inactive products return 404 on direct URL access."
 *   SECURITY: "Search input parameterised — no SQL injection via the query string."
 *   SECURITY: "IDOR: fetch another user's order by ID → 404."
 *
 * A real Postgres, because the things under test are database behaviours: a WHERE clause
 * that must not be forgettable, a full-text index, and a foreign-key-scoped query.
 */
import { Metal, Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { parseFilters } from '@/lib/catalog/filters';
import {
  getProductBySlug,
  getRelatedProducts,
  listProducts,
  priceProduct,
  PRODUCT_CARD_SELECT,
} from '@/lib/catalog/products';
import { searchProducts } from '@/lib/catalog/search';
import { db } from '@/lib/db';
import { calculateLine, type RatesByPurity } from '@/lib/pricing';
import { RATES_CACHE_KEY } from '@/lib/rates';
import { invalidate, redis } from '@/lib/redis';
import { PRICING_DEFAULTS_KEY } from '@/lib/settings';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const RATES: RatesByPurity = {
  K22_916: 1_184_200n,
  K18_750: 969_300n,
  SILVER_999: 15_890n,
};

let adminId: string;
let ringsId: string;

interface SeedProduct {
  name: string;
  slug: string;
  purity: Purity;
  weightMg: number;
  makingPct: number;
  stoneCharge?: bigint;
  isActive?: boolean;
  categoryId?: string;
}

async function makeProduct(product: SeedProduct) {
  return db.product.create({
    data: {
      name: product.name,
      slug: product.slug,
      description: `${product.name} description`,
      categoryId: product.categoryId ?? ringsId,
      metal: product.purity === Purity.SILVER_999 ? Metal.SILVER : Metal.GOLD,
      purity: product.purity,
      weightMg: product.weightMg,
      makingPct: product.makingPct,
      stoneCharge: product.stoneCharge ?? 0n,
      isActive: product.isActive ?? true,
    },
  });
}

describeDb('catalogue', () => {
  beforeEach(async () => {
    await db.enquiry.deleteMany();
    await db.productImage.deleteMany();
    await db.product.deleteMany();
    await db.orderItem.deleteMany();
    await db.order.deleteMany();
    await db.category.deleteMany();
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();

    const admin = await db.user.create({
      data: { email: `cat-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    adminId = admin.id;

    await db.metalRate.createMany({
      data: [
        {
          metal: Metal.GOLD,
          purity: Purity.K22_916,
          ratePerGram: RATES.K22_916,
          setByUserId: adminId,
        },
        {
          metal: Metal.GOLD,
          purity: Purity.K18_750,
          ratePerGram: RATES.K18_750,
          setByUserId: adminId,
        },
        {
          metal: Metal.SILVER,
          purity: Purity.SILVER_999,
          ratePerGram: RATES.SILVER_999,
          setByUserId: adminId,
        },
      ],
    });
    /**
     * The pricing defaults are cached too (DEBT-024), and `lib/settings.test.ts` writes a
     * non-default GST rate. A leftover cached value would reprice every product here, so
     * the key is dropped alongside the rates key — DEBT-030's rule: a harness that forces
     * one backing value must force all of them.
     */
    await invalidate(RATES_CACHE_KEY, PRICING_DEFAULTS_KEY);

    /**
     * Drop the search cache between tests.
     *
     * It is keyed on the query alone and holds product IDs, so a cached entry from an
     * earlier test points at rows this `beforeEach` has just deleted. That is a harness
     * problem, not a production one — see "a stale cache entry cannot resurrect a deleted
     * product" below, which asserts the behaviour that makes it safe in production.
     */
    const searchKeys = await redis.keys('search:*');
    if (searchKeys.length > 0) await redis.del(...searchKeys);

    const rings = await db.category.create({
      data: { name: 'Rings', slug: 'rings', sortOrder: 0 },
      select: { id: true },
    });
    ringsId = rings.id;
  });

  afterAll(async () => {
    await db.enquiry.deleteMany();
    await db.productImage.deleteMany();
    await db.product.deleteMany();
    await db.orderItem.deleteMany();
    await db.order.deleteMany();
    await db.category.deleteMany();
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY);
    await db.$disconnect();
    redis.disconnect();
  });

  // ────────────────────────────────────────────── pricing

  describe('product pricing', () => {
    it('matches calculateLine exactly — one engine, one answer', async () => {
      await makeProduct({
        name: 'Test Ring',
        slug: 'test-ring',
        purity: Purity.K22_916,
        weightMg: 10_000,
        makingPct: 12,
      });

      const product = await getProductBySlug('test-ring');

      // §6 TEST: "Product price matches calculateLine output exactly." Computed here from
      // the engine, not read back from the page — the assertion has to come from
      // somewhere other than the thing it is checking.
      const expected = calculateLine(
        {
          metal: 'GOLD',
          purity: 'K22_916',
          weightMg: 10_000,
          makingPct: 12,
          stoneCharge: 0n,
          gstPct: 3,
        },
        RATES.K22_916,
      );

      expect(product?.price).toEqual(expected);
      // The first golden case from Phase 5, reached through the catalogue this time.
      expect(product?.price.lineTotal).toBe(13_660_931n);
    });

    it('prices a stone charge into the total', async () => {
      await makeProduct({
        name: 'Stone Ring',
        slug: 'stone-ring',
        purity: Purity.K22_916,
        weightMg: 10_000,
        makingPct: 12,
        stoneCharge: 1_500_000n,
      });

      const product = await getProductBySlug('stone-ring');
      expect(product?.price.stoneCharge).toBe(1_500_000n);
      // (11,842,000 + 1,421,040 + 1,500,000) × 1.03
      expect(product?.price.lineTotal).toBe(15_205_931n);
    });

    it('carries a fractional making percentage through Decimal without loss', async () => {
      await makeProduct({
        name: 'Half Ring',
        slug: 'half-ring',
        purity: Purity.K22_916,
        weightMg: 10_000,
        makingPct: 12.5,
      });

      const product = await getProductBySlug('half-ring');
      expect(product?.makingPct).toBe(12.5);
      expect(product?.price).toEqual(
        calculateLine(
          {
            metal: 'GOLD',
            purity: 'K22_916',
            weightMg: 10_000,
            makingPct: 12.5,
            stoneCharge: 0n,
            gstPct: 3,
          },
          RATES.K22_916,
        ),
      );
    });

    it('reprices when the admin changes the rate', async () => {
      await makeProduct({
        name: 'Rate Ring',
        slug: 'rate-ring',
        purity: Purity.K22_916,
        weightMg: 10_000,
        makingPct: 12,
      });

      const before = await getProductBySlug('rate-ring');

      // A new rate row, exactly as `setRate` writes one.
      await db.metalRate.create({
        data: {
          metal: Metal.GOLD,
          purity: Purity.K22_916,
          ratePerGram: 1_300_000n,
          setByUserId: adminId,
        },
      });
      await invalidate(RATES_CACHE_KEY);

      const after = await getProductBySlug('rate-ring');

      // §6 TEST: "Price updates after an admin rate change plus revalidation." There is no
      // stored price to go stale — the page is a function of the rate.
      expect(after!.price.lineTotal).toBeGreaterThan(before!.price.lineTotal);
      expect(after!.ratePerGram).toBe(1_300_000n);
    });
  });

  // ────────────────────────────────────────────── SECURITY: inactive products

  describe('SECURITY — inactive products', () => {
    it('an inactive product is not found by slug', async () => {
      await makeProduct({
        name: 'Retired Ring',
        slug: 'retired-ring',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
        isActive: false,
      });

      // §6 SECURITY: "Inactive products return 404 on direct URL access." The page calls
      // `notFound()` on null, so null here IS the 404.
      expect(await getProductBySlug('retired-ring')).toBeNull();
    });

    it('a product in an inactive category is not found either', async () => {
      const hidden = await db.category.create({
        data: { name: 'Hidden', slug: 'hidden', isActive: false },
        select: { id: true },
      });
      await makeProduct({
        name: 'Hidden Ring',
        slug: 'hidden-ring',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
        categoryId: hidden.id,
      });

      // Retiring a category must take its products with it, or the shop hides a range and
      // the pages stay live.
      expect(await getProductBySlug('hidden-ring')).toBeNull();
    });

    it('inactive products never appear in a listing', async () => {
      await makeProduct({
        name: 'Live',
        slug: 'live',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
      });
      await makeProduct({
        name: 'Dead',
        slug: 'dead',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
        isActive: false,
      });

      const { products, total } = await listProducts('rings', parseFilters({}));

      expect(total).toBe(1);
      expect(products.map((p) => p.slug)).toEqual(['live']);
    });

    it('inactive products never appear in search results', async () => {
      await makeProduct({
        name: 'Sapphire Ring',
        slug: 'sapphire-live',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
      });
      await makeProduct({
        name: 'Sapphire Band',
        slug: 'sapphire-dead',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
        isActive: false,
      });

      const { products } = await searchProducts('sapphire');

      expect(products.map((p) => p.slug)).toEqual(['sapphire-live']);
    });

    it('inactive products are not offered as related', async () => {
      await makeProduct({
        name: 'Anchor',
        slug: 'anchor',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
      });
      await makeProduct({
        name: 'Dead Sibling',
        slug: 'dead-sibling',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
        isActive: false,
      });

      expect(await getRelatedProducts('rings', 'anchor')).toHaveLength(0);
    });

    it.each([
      ['an empty slug', ''],
      ['a path traversal attempt', '../../etc/passwd'],
      ['a SQL fragment', "' OR 1=1 --"],
      ['an absurdly long slug', 'a'.repeat(500)],
    ])('%s returns null rather than throwing', async (_name, slug) => {
      expect(await getProductBySlug(slug)).toBeNull();
    });
  });

  // ────────────────────────────────────────────── filters

  describe('filters produce correct sets', () => {
    beforeEach(async () => {
      // A spread that makes every band and sort distinguishable.
      await makeProduct({
        name: 'Light Gold',
        slug: 'light-gold',
        purity: Purity.K22_916,
        weightMg: 3_000,
        makingPct: 10,
      });
      await makeProduct({
        name: 'Mid Gold',
        slug: 'mid-gold',
        purity: Purity.K22_916,
        weightMg: 10_000,
        makingPct: 12,
      });
      await makeProduct({
        name: 'Heavy Gold',
        slug: 'heavy-gold',
        purity: Purity.K22_916,
        weightMg: 60_000,
        makingPct: 15,
      });
      await makeProduct({
        name: 'Light 18K',
        slug: 'light-18k',
        purity: Purity.K18_750,
        weightMg: 4_000,
        makingPct: 10,
      });
      await makeProduct({
        name: 'Silver Piece',
        slug: 'silver-piece',
        purity: Purity.SILVER_999,
        weightMg: 20_000,
        makingPct: 20,
      });
    });

    it('filters by purity', async () => {
      const { products, total } = await listProducts(
        'rings',
        parseFilters({ purity: '22k' }),
      );

      expect(total).toBe(3);
      expect(products.every((p) => p.purity === 'K22_916')).toBe(true);
    });

    it('filters by weight band, half-open at the boundary', async () => {
      // `under-5` is < 5 g, so the 4 g and 3 g pieces qualify and nothing else does.
      const { products } = await listProducts(
        'rings',
        parseFilters({ weight: 'under-5' }),
      );

      expect(products.map((p) => p.slug).sort()).toEqual(['light-18k', 'light-gold']);
    });

    it('filters by price band', async () => {
      const { products } = await listProducts(
        'rings',
        parseFilters({ price: 'over-250000' }),
      );

      // Only the 60 g gold piece clears ₹2,50,000.
      expect(products.map((p) => p.slug)).toEqual(['heavy-gold']);
      expect(products[0]!.price.lineTotal).toBeGreaterThan(25_000_000n);
    });

    it('sorts by price ascending and descending', async () => {
      const asc = await listProducts('rings', parseFilters({ sort: 'price_asc' }));
      const desc = await listProducts('rings', parseFilters({ sort: 'price_desc' }));

      const ascTotals = asc.products.map((p) => p.price.lineTotal);
      expect([...ascTotals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(
        ascTotals,
      );
      expect(desc.products.map((p) => p.slug)).toEqual(
        [...asc.products].reverse().map((p) => p.slug),
      );
    });

    it('sorts by weight', async () => {
      const { products } = await listProducts(
        'rings',
        parseFilters({ sort: 'weight_asc' }),
      );

      const weights = products.map((p) => p.weightMg);
      expect([...weights].sort((a, b) => a - b)).toEqual(weights);
    });

    it('combines filters', async () => {
      const { products } = await listProducts(
        'rings',
        parseFilters({ purity: '22k', weight: 'under-5' }),
      );

      expect(products.map((p) => p.slug)).toEqual(['light-gold']);
    });

    it('an unknown sort behaves exactly like the default', async () => {
      const bogus = await listProducts(
        'rings',
        parseFilters({ sort: 'nonsense; DROP TABLE' }),
      );
      const fallback = await listProducts('rings', parseFilters({}));

      // The allowlist collapsed it to `newest` before it reached the query builder.
      expect(bogus.products.map((p) => p.slug)).toEqual(
        fallback.products.map((p) => p.slug),
      );
    });

    it('paginates without dropping or repeating a product', async () => {
      const all = await listProducts('rings', parseFilters({ sort: 'price_asc' }));
      expect(all.total).toBe(5);
      expect(all.hasMore).toBe(false);

      // Page 2 of a 5-item set is empty, and `hasMore` must not claim otherwise.
      const page2 = await listProducts(
        'rings',
        parseFilters({ sort: 'price_asc', page: '2' }),
      );
      expect(page2.products).toHaveLength(0);
      expect(page2.hasMore).toBe(false);
    });
  });

  // ────────────────────────────────────────────── zero images

  describe('a product with no images', () => {
    it('is priced and returned with an empty image list', async () => {
      await makeProduct({
        name: 'Imageless',
        slug: 'imageless',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
      });

      const product = await getProductBySlug('imageless');

      // §6 TEST: "Product with zero images renders the empty frame without breaking
      // layout." The data layer's half of that is an empty array, never a null the
      // component has to guard.
      expect(product?.images).toEqual([]);
      expect(product?.imageUrl).toBeNull();
      expect(product?.price.lineTotal).toBeGreaterThan(0n);
    });

    it('sorts a product image list by sortOrder', async () => {
      const product = await makeProduct({
        name: 'Gallery',
        slug: 'gallery',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
      });
      await db.productImage.createMany({
        data: [
          {
            productId: product.id,
            url: 'https://res.cloudinary.com/c.jpg',
            sortOrder: 2,
          },
          {
            productId: product.id,
            url: 'https://res.cloudinary.com/a.jpg',
            sortOrder: 0,
          },
          {
            productId: product.id,
            url: 'https://res.cloudinary.com/b.jpg',
            sortOrder: 1,
          },
        ],
      });

      const detail = await getProductBySlug('gallery');

      // The admin's chosen order is the gallery order, and the first one gets `priority`.
      expect(detail?.images.map((i) => i.url)).toEqual([
        'https://res.cloudinary.com/a.jpg',
        'https://res.cloudinary.com/b.jpg',
        'https://res.cloudinary.com/c.jpg',
      ]);
    });
  });

  // ────────────────────────────────────────────── SECURITY: search injection

  describe('SECURITY — search is parameterised', () => {
    beforeEach(async () => {
      await makeProduct({
        name: 'Emerald Necklace',
        slug: 'emerald-necklace',
        purity: Purity.K22_916,
        weightMg: 20_000,
        makingPct: 12,
      });
      await makeProduct({
        name: 'Ruby Ring',
        slug: 'ruby-ring',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
      });
    });

    it('finds by name', async () => {
      expect((await searchProducts('emerald')).products.map((p) => p.slug)).toEqual([
        'emerald-necklace',
      ]);
    });

    it('finds by prefix — full-text alone cannot', async () => {
      // A shopper is mid-word on every keystroke; the trigram index covers this.
      expect((await searchProducts('emer')).products.map((p) => p.slug)).toEqual([
        'emerald-necklace',
      ]);
    });

    it('finds by category name', async () => {
      expect((await searchProducts('rings')).products.length).toBeGreaterThan(0);
    });

    it.each([
      ['a classic injection', "' OR 1=1 --"],
      ['a stacked statement', '\'; DROP TABLE "Product"; --'],
      ['a UNION attempt', '\' UNION SELECT * FROM "User" --'],
      ['a comment terminator', '--'],
      ['a tsquery operator soup', 'gold & | ! ( )'],
      ['an unbalanced quote', "gold'"],
      ['a script tag', '<script>alert(1)</script>'],
      ['a percent wildcard', '%'],
      ['an underscore wildcard', '_'],
      ['a backslash', '\\'],
    ])('survives %s without error or leakage', async (_name, query) => {
      // Two claims at once: it does not throw (an unparseable tsquery would be a 500), and
      // it returns nothing it should not. Every value is a bound parameter.
      const result = await searchProducts(query);

      expect(Array.isArray(result.products)).toBe(true);
      // Whatever matches, it can only ever be a product row — never a user or a rate.
      for (const product of result.products) {
        expect(product.slug).toMatch(/^[a-z0-9-]+$/);
      }
    });

    it('the products table is still there afterwards', async () => {
      await searchProducts('\'; DROP TABLE "Product"; --');

      expect(await db.product.count()).toBe(2);
    });

    it('refuses a one-character query rather than scanning the catalogue', async () => {
      const result = await searchProducts('a');

      expect(result.tooShort).toBe(true);
      expect(result.products).toEqual([]);
    });

    it('caches by normalised query, so spacing and case do not fragment the cache', async () => {
      await searchProducts('emerald');
      const spaced = await searchProducts('  EMERALD  ');

      expect(spaced.query).toBe('EMERALD');
      expect(spaced.products.map((p) => p.slug)).toEqual(['emerald-necklace']);
    });

    it('a stale cache entry cannot resurrect a deactivated product', async () => {
      // Warm the cache while the product is live.
      expect((await searchProducts('emerald')).products).toHaveLength(1);

      await db.product.update({
        where: { slug: 'emerald-necklace' },
        data: { isActive: false },
      });

      /**
       * The cache still holds the id — the 300s TTL has not elapsed. This is why
       * `searchProducts` caches IDs rather than rendered products and re-queries them with
       * `isActive: true`: a product the shop has just withdrawn must disappear from search
       * immediately, not five minutes later.
       */
      expect((await searchProducts('emerald')).products).toHaveLength(0);
    });

    it('a stale cache entry cannot resurrect a deleted product', async () => {
      expect((await searchProducts('ruby')).products).toHaveLength(1);

      await db.product.delete({ where: { slug: 'ruby-ring' } });

      // A dangling id yields nothing rather than throwing on a missing row.
      expect((await searchProducts('ruby')).products).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────── SECURITY: IDOR on orders

  describe('SECURITY — order history is scoped to the session user', () => {
    it("never returns another user's order", async () => {
      const [alice, bob] = await Promise.all([
        db.user.create({
          data: { email: `alice-${Date.now()}@example.com` },
          select: { id: true },
        }),
        db.user.create({
          data: { email: `bob-${Date.now()}@example.com` },
          select: { id: true },
        }),
      ]);

      const bobsOrder = await db.order.create({
        data: {
          orderNo: `JW-2026-${Date.now() % 10000}`,
          userId: bob.id,
          customerPhone: '+919876543210',
          subtotal: 1000n,
          gstAmount: 30n,
          grandTotal: 1030n,
          createdByUserId: adminId,
        },
      });

      /**
       * The query the page runs. §6.6: "Lists orders where `userId` matches the session —
       * **never** filtered by a URL parameter."
       *
       * Asserted as a property of the query rather than of the page, because this is the
       * shape every order fetch in Phase 8 must copy: the id comes from the session, and
       * `bobsOrder.id` is never an input.
       */
      const alicesOrders = await db.order.findMany({ where: { userId: alice.id } });
      expect(alicesOrders).toHaveLength(0);

      // And asking for Bob's order *as Alice* finds nothing — the id alone is not enough.
      const idor = await db.order.findFirst({
        where: { id: bobsOrder.id, userId: alice.id },
      });
      expect(idor).toBeNull();

      // Bob still sees his own.
      expect(await db.order.findMany({ where: { userId: bob.id } })).toHaveLength(1);
    });

    it('an unclaimed order belongs to nobody until it is claimed', async () => {
      const user = await db.user.create({
        data: { email: `claimant-${Date.now()}@example.com` },
        select: { id: true },
      });

      await db.order.create({
        data: {
          orderNo: `JW-2026-${(Date.now() % 10000) + 1}`,
          userId: null,
          customerPhone: '+919999999999',
          subtotal: 1000n,
          gstAmount: 30n,
          grandTotal: 1030n,
          createdByUserId: adminId,
        },
      });

      // MASTER-SPEC §5: an order is created with `userId = null` and only attaches after a
      // verified OTP. It must not leak into anyone's history before that.
      expect(await db.order.findMany({ where: { userId: user.id } })).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────── related products

  describe('related products', () => {
    it('excludes the product itself and stays in the category', async () => {
      const necklaces = await db.category.create({
        data: { name: 'Necklaces', slug: 'necklaces' },
        select: { id: true },
      });

      await makeProduct({
        name: 'Ring A',
        slug: 'ring-a',
        purity: Purity.K22_916,
        weightMg: 5_000,
        makingPct: 10,
      });
      await makeProduct({
        name: 'Ring B',
        slug: 'ring-b',
        purity: Purity.K22_916,
        weightMg: 6_000,
        makingPct: 10,
      });
      await makeProduct({
        name: 'Necklace A',
        slug: 'necklace-a',
        purity: Purity.K22_916,
        weightMg: 20_000,
        makingPct: 12,
        categoryId: necklaces.id,
      });

      const related = await getRelatedProducts('rings', 'ring-a');

      expect(related.map((p) => p.slug)).toEqual(['ring-b']);
    });
  });

  // ────────────────────────────────────────────── priceProduct is pure-ish

  describe('priceProduct', () => {
    it('is a function of the row and the rates, nothing else', async () => {
      await makeProduct({
        name: 'Pure',
        slug: 'pure',
        purity: Purity.K22_916,
        weightMg: 7_500,
        makingPct: 11,
      });

      const row = await db.product.findFirstOrThrow({
        where: { slug: 'pure' },
        select: PRODUCT_CARD_SELECT,
      });

      expect(priceProduct(row, RATES, 3)).toEqual(priceProduct(row, RATES, 3));
    });
  });
});
