/**
 * §9.5's one degradation case that only a browser can answer: the image CDN is down.
 * Created by Phase 9 (specs/09-hardening.md §9.5).
 *
 * ── Why this is not in `scripts/verify-degradation.mts` with the other three ──
 * That script kills containers and asks the server what it returns. This claim is not about
 * a response — §9.5 asks for "branded empty frames, no broken layout", which is a statement
 * about rendered geometry. A 200 from `/products/x` proves nothing about whether the page
 * collapsed once its images failed to load, and neither does the HTML: at request time the
 * markup is identical whether the CDN answers or not. The difference exists only after
 * layout, in the browser.
 *
 * ── How the CDN is taken down ──
 * `page.route` aborts every request whose URL touches the image host — both the direct
 * `res.cloudinary.com` form and the `/_next/image?url=…` proxy, since Next's optimiser
 * fetches upstream on the server and returns an error status when it cannot. Aborting is a
 * fair simulation of "the CDN is down": it is what the browser sees for DNS failure,
 * connection refused and a timeout alike.
 *
 * ── What is asserted ──
 * §9.5 asks for two things and they are separate claims. "No broken layout" is geometry:
 * nothing collapses to zero height, nothing overflows sideways, and the page's own content
 * (price, name, CTA) is still where it was. "Branded empty frames" is what fills the hole —
 * the monogram tile, not the browser's torn-page glyph.
 *
 * The second claim FAILED when this file was first written, and the screenshot is why the
 * fix exists: with real photography on the page the frame kept its 335×335 box and its tint,
 * and Chrome drew its broken-image icon in the corner. `ImageWithFallback` closes it. The
 * test asserting the monogram would have passed all along against a slot that never had an
 * image at all, which is the version of this test not worth writing.
 */
import { expect, test, type Page } from '@playwright/test';

/** Kept in step with `ALLOWED_IMAGE_HOSTS`; a host added there belongs here too. */
const CDN_HOSTS = ['res.cloudinary.com', 'utfs.io'];

async function killImageCdn(page: Page): Promise<{ blocked: () => number }> {
  let blocked = 0;

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const isCdn = CDN_HOSTS.some((host) => url.includes(host));
    /**
     * Every `/_next/image` request, whatever the upstream — not only the ones whose query
     * names a CDN host.
     *
     * It used to match the host inside the percent-encoded `url=` parameter, which tied the
     * test to the photographs happening to live on Cloudinary. On a freshly seeded shop —
     * which is what CI has — nothing was intercepted and the control assertion below
     * correctly reported "the test is not testing". Aborting the optimiser endpoint is the
     * same simulation, hermetically: it is what the browser sees whether the CDN is down,
     * the DNS fails, or the optimiser itself cannot reach upstream.
     */
    const isOptimised = url.includes('/_next/image');

    if (isCdn || isOptimised) {
      blocked += 1;
      await route.abort('connectionfailed');
      return;
    }
    await route.continue();
  });

  return { blocked: () => blocked };
}

/** Every element that draws an image frame, whether or not the image loaded. */
const FRAME = '[data-image-frame]';

/**
 * The product `pnpm lighthouse` and §9.2 both measure, chosen for the same reason: it is one
 * of the pieces that actually has photography, so blocking the CDN takes something away.
 * A fixed slug, matching `e2e/a11y.spec.ts` and `e2e/catalog.spec.ts` — `/collections` links
 * to a category, not to a product, so crawling for one costs a page load and finds nothing.
 */
const PRODUCT_PATH = '/products/classic-solitaire-ring';

test.describe('image CDN down', () => {
  test('the homepage keeps its layout when no image loads', async ({ page }) => {
    const cdn = await killImageCdn(page);
    await page.goto('/');

    // The control. If nothing was blocked, this test proves nothing at all — it would pass
    // just as green against a page that never requested an image.
    expect(
      cdn.blocked(),
      'no CDN request was intercepted — the test is not testing',
    ).toBeGreaterThan(0);

    // §9.5: "no broken layout". Horizontal overflow is the failure a missing image causes
    // when a container sizes itself to its content.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, 'the page must not scroll sideways with the CDN down').toBe(false);

    // The ticker is the reason people visit (§4.5) and owes nothing to the CDN.
    // Stage 4B replaced the metal toggle with a card showing all three rates at once, so
    // the card itself is the thing that must survive a dead image CDN.
    await expect(page.getByTestId('rate-ticker')).toBeVisible();
    await expect(page.getByTestId('ticker-value')).toBeVisible();
    await expect(page.getByText(/Indicative rate/)).toBeVisible();
  });

  test('image frames keep their reserved space instead of collapsing', async ({
    page,
  }) => {
    await killImageCdn(page);
    await page.goto(PRODUCT_PATH);

    /**
     * The whole point of `ImageFrame`'s fixed `aspect-ratio` (Phase 2 §2.2): the box is
     * sized by the ratio, not by the image, so a failed load leaves a hole of exactly the
     * right shape rather than a zero-height line that yanks the rest of the page upwards.
     *
     * Measured in the browser. A class-name assertion would pass against a stylesheet that
     * never loaded.
     */
    const frames = page.locator(FRAME);
    const count = await frames.count();
    expect(
      count,
      'the product page must render at least one image frame',
    ).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const box = await frames.nth(i).boundingBox();
      if (!box) continue; // Off-screen carousel slides have no box; they are not the claim.
      expect(box.height, `frame ${i} collapsed to ${box.height}px`).toBeGreaterThan(20);
      expect(box.width, `frame ${i} collapsed to ${box.width}px`).toBeGreaterThan(20);
    }
  });

  test('the product page still shows its price and its call to action', async ({
    page,
  }) => {
    await killImageCdn(page);
    await page.goto(PRODUCT_PATH);

    // A jewellery page whose photographs are missing is a bad page. One that also loses the
    // price and the way to enquire is a broken one — that is the line §9.5 draws.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/₹/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /WhatsApp/i }).first()).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('every frame falls back to the branded tile, not the broken-image glyph', async ({
    page,
  }) => {
    await killImageCdn(page);
    await page.goto(PRODUCT_PATH);

    /**
     * §9.5's actual words: "branded empty frames". A frame that keeps its shape and shows
     * Chrome's torn-page icon satisfies "no broken layout" and fails this.
     *
     * Asserted on the gallery frame specifically rather than "somewhere on the page", so a
     * monogram belonging to an unrelated empty slot cannot make it pass.
     */
    const gallery = page.locator(FRAME).first();
    await expect(gallery.getByText('TJ', { exact: true })).toBeVisible();

    // And the failed <img> is gone rather than merely covered — an image element with no
    // intrinsic size is what draws the glyph, so leaving it under the tile would still show.
    await expect(gallery.locator('img')).toHaveCount(0);
  });

  test('a healthy CDN still renders the photograph — the negative control', async ({
    page,
  }) => {
    /**
     * Without this, every assertion above passes just as green against a component that
     * ALWAYS renders the monogram and never shows a product photograph at all. That would
     * be a worse bug than the one being fixed, and invisible to the rest of this file.
     */
    await page.goto(PRODUCT_PATH);

    const gallery = page.locator(FRAME).first();
    await expect(gallery.locator('img').first()).toBeVisible();
    await expect(gallery.getByText('TJ', { exact: true })).toHaveCount(0);

    const loaded = await gallery
      .locator('img')
      .first()
      .evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(
      loaded,
      'the photograph must actually decode when the CDN is up',
    ).toBeGreaterThan(0);
  });
});
