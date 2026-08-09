/**
 * Phase 9 §9.6 — SEO and content, checked in the served HTML.
 *
 * `lib/seo.test.ts` asserts the builders and the agreement between sitemap and robots. This
 * file asserts the part those cannot see: that the tags actually reach the page. A canonical
 * that is computed correctly and never rendered — because a route forgot to spread it, or a
 * layout overwrote it — is the failure mode here, and it is invisible from Node.
 */
import { expect, test } from '@playwright/test';

/** Every public route that should be indexable, with the canonical it must declare. */
const CANONICAL_ROUTES: [route: string, canonicalPath: string][] = [
  ['/', '/'],
  ['/rates', '/rates'],
  ['/collections', '/collections'],
  ['/collections/rings', '/collections/rings'],
  ['/products/classic-solitaire-ring', '/products/classic-solitaire-ring'],
  ['/calculator', '/calculator'],
  ['/policies/privacy', '/policies/privacy'],
  ['/policies/terms', '/policies/terms'],
  ['/policies/shipping', '/policies/shipping'],
  ['/policies/refunds', '/policies/refunds'],
  ['/policies/buyback', '/policies/buyback'],
  ['/policies/exchange', '/policies/exchange'],
];

test.describe('§9.6 — canonical URLs', () => {
  for (const [route, canonicalPath] of CANONICAL_ROUTES) {
    test(`${route} declares its canonical`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile-375', 'Markup, not layout');

      await page.goto(route);
      const href = await page.locator('link[rel="canonical"]').getAttribute('href');

      expect(href, `${route} has no canonical`).toBeTruthy();
      expect(new URL(href!).pathname).toBe(canonicalPath);
      // Absolute and on a real origin — a relative canonical resolves against
      // `metadataBase`, and a wrong one is invisible until production.
      expect(href!.startsWith('http')).toBe(true);
    });
  }

  test('a filtered collection points at the unfiltered one', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'Markup, not layout');

    // §6.1 puts filters in the URL, so every purity × sort × page combination is a distinct
    // URL for a subset of the same set. Without this they compete with each other.
    await page.goto('/collections/rings?purity=K22_916&sort=price_asc&page=2');
    const href = await page.locator('link[rel="canonical"]').getAttribute('href');

    expect(new URL(href!).pathname).toBe('/collections/rings');
    expect(new URL(href!).search).toBe('');
  });
});

test.describe('§9.6 — structured data', () => {
  async function jsonLd(page: import('@playwright/test').Page) {
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
  }

  test('the storefront carries LocalBusiness', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'Markup, not layout');

    await page.goto('/');
    const types = (await jsonLd(page)).map((block) => block['@type']);
    expect(types).toContain('JewelryStore');
  });

  test('a product page carries Product, and its price is the price on the page', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'Markup, not layout');

    await page.goto('/products/classic-solitaire-ring');

    const product = (await jsonLd(page)).find((block) => block['@type'] === 'Product');
    expect(product, 'no Product JSON-LD on the product page').toBeTruthy();

    const offers = product!.offers as Record<string, string>;

    /**
     * The whole point of the assertion. A rich result that disagrees with the page is the
     * shop quoting a figure it will not honour, through Google, outside the disclaimer.
     * Read off the rendered total rather than recomputed, so this compares the two things a
     * customer can actually see.
     */
    const rendered = await page.getByTestId('product-total').textContent();
    const renderedRupees = (rendered ?? '').replace(/[^\d.]/g, '');

    expect(offers.price).toBe(renderedRupees);
    expect(offers.priceCurrency).toBe('INR');
    // There is no checkout. Claiming online availability is the one structured-data lie a
    // customer could act on.
    expect(offers.availability).toBe('https://schema.org/InStoreOnly');
  });

  test('every JSON-LD block parses — an unescaped name would break it', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'Markup, not layout');

    for (const route of ['/', '/products/temple-necklace-set', '/collections/rings']) {
      await page.goto(route);
      // `jsonLd` throws on malformed JSON, which is the assertion.
      const blocks = await jsonLd(page);
      expect(blocks.length, `${route} rendered no JSON-LD`).toBeGreaterThan(0);
    }
  });
});

test.describe('§9.6 — robots.txt and sitemap.xml', () => {
  test('robots.txt disallows /admin and /bills and points at the sitemap', async ({
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'One origin, not three');

    const body = await (await request.get('/robots.txt')).text();

    expect(body).toContain('Disallow: /admin');
    expect(body).toContain('Disallow: /bills');
    expect(body).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
  });

  test('sitemap.xml is served, is XML, and lists real routes', async ({
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'One origin, not three');

    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('xml');

    const body = await response.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('/collections');
    expect(body).toContain('/policies/privacy');
  });

  /**
   * Every URL in the sitemap is fetched. A sitemap is a list of promises to a crawler, and
   * a 404 in it is the one defect that a build cannot catch and that nobody notices for
   * months — the page it points at is, by definition, one nobody visits.
   */
  test('every URL in the sitemap resolves', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'One origin, not three');

    const body = await (await request.get('/sitemap.xml')).text();
    const urls = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);

    expect(urls.length, 'sitemap is empty').toBeGreaterThan(4);

    const broken: string[] = [];
    for (const url of urls) {
      // Fetched by path so this works against the test origin rather than the configured
      // production one.
      const path = new URL(url).pathname;
      const response = await request.get(path);
      if (response.status() !== 200) broken.push(`${path} → ${response.status()}`);
    }

    expect(broken, 'sitemap lists URLs that do not resolve').toEqual([]);
  });
});

test.describe('§9.6 — the legal pages exist and say something', () => {
  for (const slug of ['privacy', 'terms', 'shipping', 'refunds']) {
    test(`/policies/${slug} renders`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile-375', 'Content, not layout');

      const response = await page.goto(`/policies/${slug}`);
      expect(response?.status()).toBe(200);

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Not an empty shell: §9.6 asks for pages, and a heading with no body is not one.
      const body = await page.locator('main').textContent();
      expect((body ?? '').length).toBeGreaterThan(400);
    });
  }

  test('the footer links to them, or nobody will find them', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'Content, not layout');

    await page.goto('/');
    for (const slug of ['privacy', 'terms', 'shipping', 'refunds']) {
      await expect(
        page.locator(`footer a[href="/policies/${slug}"]`),
        `footer has no link to /policies/${slug}`,
      ).toHaveCount(1);
    }
  });
});
