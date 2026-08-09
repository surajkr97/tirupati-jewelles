/**
 * Phase 9 TEST — §9.6's SEO surfaces.
 *
 * The interesting failures in this section are all failures of AGREEMENT rather than of any
 * single value, and none of them is visible on the page:
 *
 *   - a sitemap that lists a URL `robots.txt` disallows,
 *   - a JSON-LD price that disagrees with the price rendered beside it,
 *   - a canonical pointing at the wrong origin.
 *
 * Nothing breaks, no test fails, and the shop quietly ranks for nothing or advertises a price
 * it will not honour. So these assert the two artefacts against EACH OTHER and against the
 * pricing engine, rather than checking that each one exists.
 */
import { Metal, Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { getProductBySlug } from '@/lib/catalog/products';
import { db } from '@/lib/db';
import { calculateLine } from '@/lib/pricing';
import { RATES_CACHE_KEY } from '@/lib/rates';
import { invalidate } from '@/lib/redis';
import {
  absoluteUrl,
  canonical,
  localBusinessJsonLd,
  productJsonLd,
  SITE_URL,
} from '@/lib/seo';
import { PRICING_DEFAULTS_KEY } from '@/lib/settings';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

describe('absolute URLs', () => {
  it('never emits a double slash, whichever way the path is written', () => {
    expect(absoluteUrl('/rates')).toBe(`${SITE_URL}/rates`);
    expect(absoluteUrl('rates')).toBe(`${SITE_URL}/rates`);
  });

  it('SITE_URL carries no trailing slash, or every URL would gain one', () => {
    expect(SITE_URL.endsWith('/')).toBe(false);
  });

  it('a canonical is absolute — a relative one silently follows metadataBase', () => {
    expect(canonical('/collections/rings').alternates.canonical).toBe(
      `${SITE_URL}/collections/rings`,
    );
  });
});

describe('robots.txt', () => {
  const rules = () => {
    const result = robots();
    const rule = Array.isArray(result.rules) ? result.rules[0]! : result.rules!;
    const disallow = rule.disallow;
    return Array.isArray(disallow) ? disallow : [disallow!];
  };

  it('disallows what §9.6 names', () => {
    expect(rules()).toEqual(expect.arrayContaining(['/admin', '/bills']));
  });

  it('also disallows the three private surfaces §9.6 does not name', () => {
    // A crawler fetching a claim link BURNS a single-use token (DEBT-011); a share link is
    // someone's private link (SEC-012); /account is one customer's purchase history.
    expect(rules()).toEqual(
      expect.arrayContaining(['/claim', '/calculator/s', '/account']),
    );
  });

  it('points at the sitemap it actually has', () => {
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe('LocalBusiness', () => {
  it('omits an address the owner has not supplied rather than inventing one', () => {
    const json = localBusinessJsonLd({
      shopName: 'Tirupati Jewelles',
      address: null,
      contactPhone: null,
    });

    expect(json).not.toHaveProperty('address');
    expect(json).not.toHaveProperty('telephone');
    expect(json.name).toBe('Tirupati Jewelles');
    expect(json['@type']).toBe('JewelryStore');
  });

  it('carries them when it has them', () => {
    const json = localBusinessJsonLd({
      shopName: 'Tirupati Jewelles',
      address: '12 Main Bazaar, Example City',
      contactPhone: '+919876543210',
    });

    expect(json).toMatchObject({
      address: '12 Main Bazaar, Example City',
      telephone: '+919876543210',
    });
  });
});

describe('Product structured data', () => {
  const base = {
    name: 'Temple necklace',
    slug: 'temple-necklace',
    description: 'Heavy, hallmarked.',
    imageUrls: ['https://cdn.example.com/a.jpg'],
    pricePaise: 74725199n,
    purityLabel: '22K (916 gold)',
    weightGrams: '48.500',
    hallmarkNo: 'HUID123',
  };

  it('converts paise to rupees exactly, without rounding money', () => {
    // MASTER-SPEC §4: money is integer paise. 100 divides them exactly, so this is the one
    // conversion in the codebase that cannot lose a paisa — and the assertion says so.
    expect(productJsonLd(base, '2026-01-01T00:00:00.000Z').offers.price).toBe(
      '747251.99',
    );
  });

  it('pads a sub-10 paise remainder rather than emitting 7.5 for 7.05', () => {
    expect(productJsonLd({ ...base, pricePaise: 705n }, 'x').offers.price).toBe('7.05');
    expect(productJsonLd({ ...base, pricePaise: 700n }, 'x').offers.price).toBe('7.00');
  });

  it('says in-store only, because there is no checkout', () => {
    // The one structured-data claim a customer could act on and be wrong about. §6.3 hands
    // them to WhatsApp; nothing on this site takes an order.
    expect(productJsonLd(base, 'x').offers.availability).toBe(
      'https://schema.org/InStoreOnly',
    );
  });

  it('omits optional fields rather than emitting empty ones', () => {
    const json = productJsonLd(
      { ...base, description: null, imageUrls: [], hallmarkNo: null },
      'x',
    );

    expect(json).not.toHaveProperty('description');
    expect(json).not.toHaveProperty('image');
    expect(json).not.toHaveProperty('additionalProperty');
  });

  it('is serialisable, and `<` cannot break out of the script element', () => {
    // §7.4 lets an admin type any product name. The component escapes `<`; this asserts the
    // escape survives a hostile one.
    const hostile = productJsonLd(
      { ...base, name: '</script><img src=x onerror=alert(1)>' },
      'x',
    );
    const rendered = JSON.stringify(hostile).replace(/</g, '\\u003c');

    expect(rendered).not.toContain('</script');
    expect(rendered).not.toContain('<img');
    // …and it is still valid JSON that parses back to the original string.
    expect(JSON.parse(rendered).name).toBe('</script><img src=x onerror=alert(1)>');
  });
});

describeDb('the sitemap agrees with everything else', () => {
  beforeEach(async () => {
    await db.productImage.deleteMany();
    await db.product.deleteMany();
    await db.category.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY, PRICING_DEFAULTS_KEY);

    const admin = await db.user.create({
      data: { email: `seo-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    await db.metalRate.create({
      data: {
        metal: Metal.GOLD,
        purity: Purity.K22_916,
        ratePerGram: 1_184_200n,
        setByUserId: admin.id,
      },
    });

    const live = await db.category.create({
      data: { name: 'Rings', slug: 'rings', sortOrder: 0 },
      select: { id: true },
    });
    const hidden = await db.category.create({
      data: { name: 'Retired', slug: 'retired', sortOrder: 1, isActive: false },
      select: { id: true },
    });

    const piece = (
      name: string,
      slug: string,
      categoryId: string,
      isActive: boolean,
    ) => ({
      name,
      slug,
      categoryId,
      metal: Metal.GOLD,
      purity: Purity.K22_916,
      weightMg: 8475,
      makingPct: 12,
      stoneCharge: 0n,
      isActive,
    });

    await db.product.create({ data: piece('Live band', 'live-band', live.id, true) });
    await db.product.create({
      data: piece('Hidden band', 'hidden-band', live.id, false),
    });
    await db.product.create({
      data: piece('Retired band', 'retired-band', hidden.id, true),
    });
  });

  afterAll(async () => {
    await db.productImage.deleteMany();
    await db.product.deleteMany();
    await db.category.deleteMany();
    await invalidate(RATES_CACHE_KEY);
  });

  it('lists the live piece and neither of the two that 404', async () => {
    // A soft-deleted product, and a live product in a deactivated collection, both 404 on a
    // direct URL (§6 SECURITY). Listing either would be advertising a dead link.
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain(absoluteUrl('/products/live-band'));
    expect(urls).not.toContain(absoluteUrl('/products/hidden-band'));
    expect(urls).not.toContain(absoluteUrl('/products/retired-band'));
    expect(urls).not.toContain(absoluteUrl('/collections/retired'));
  });

  /**
   * The assertion this file exists for.
   *
   * Every sitemap URL is run against the robots rules. A sitemap that lists a disallowed URL
   * is not a small inconsistency — it is a crawl error on every affected page, and the two
   * files are edited months apart by people who do not re-read the other.
   */
  it('lists nothing robots.txt disallows', async () => {
    const result = robots();
    const rule = Array.isArray(result.rules) ? result.rules[0]! : result.rules!;
    const disallowed = (
      Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow!]
    ) as string[];

    const conflicts = (await sitemap())
      .map((entry) => new URL(entry.url).pathname)
      .filter((path) => disallowed.some((rulePath) => path.startsWith(rulePath)));

    expect(conflicts, 'sitemap lists paths robots.txt disallows').toEqual([]);
  });

  it('every URL is absolute and on this origin', async () => {
    for (const entry of await sitemap()) {
      expect(entry.url.startsWith(`${SITE_URL}/`), entry.url).toBe(true);
    }
  });

  it('dates the rate pages by the rate, not by the build', async () => {
    // `new Date()` on every build tells a crawler that every page changed on every deploy.
    const home = (await sitemap()).find((entry) => entry.url === absoluteUrl('/'));
    const newest = await db.metalRate.findFirstOrThrow({
      orderBy: { effectiveAt: 'desc' },
      select: { effectiveAt: true },
    });

    expect(home?.lastModified).toEqual(newest.effectiveAt);
  });

  /**
   * The JSON-LD price is the page's price.
   *
   * A rich result that disagrees with the page is the shop quoting a figure it will not
   * honour, through Google, outside the disclaimer — MASTER-SPEC §8's exposure with a third
   * party repeating it. Computed here from the engine rather than read back from either.
   */
  it('the Product price equals what calculateLine produces for the page', async () => {
    const product = await getProductBySlug('live-band');
    expect(product).toBeTruthy();

    const expected = calculateLine(
      {
        metal: 'GOLD',
        purity: 'K22_916',
        weightMg: 8475,
        makingPct: 12,
        stoneCharge: 0n,
        gstPct: product!.gstPct,
      },
      1_184_200n,
    ).lineTotal;

    expect(product!.price.lineTotal).toBe(expected);

    const json = productJsonLd(
      {
        name: product!.name,
        slug: product!.slug,
        description: product!.description,
        imageUrls: [],
        pricePaise: product!.price.lineTotal,
        purityLabel: '22K (916 gold)',
        weightGrams: '8.475',
        hallmarkNo: null,
      },
      'x',
    );

    const rupees = `${expected / 100n}.${String(expected % 100n).padStart(2, '0')}`;
    expect(json.offers.price).toBe(rupees);
  });
});
