/**
 * Phase 7 E2E — the admin panel in a real browser.
 * specs/07-admin-panel.md:
 *
 *   TEST: "E2E at 375px: log in as admin, update a rate, add a product with an image URL,
 *          verify it appears on the storefront."
 *   SECURITY: "Every /admin route ... Non-admins get 404, never 403."
 *
 * The rate change is made and then put back, because these run against the development
 * database and a test that leaves gold at ₹1 is a test that breaks every other suite.
 */
import { expect, test } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

const ADMIN_ROUTES = [
  '/admin',
  '/admin/rates',
  '/admin/products',
  '/admin/products/new',
  '/admin/categories',
  '/admin/media',
  '/admin/settings',
  '/admin/audit',
];

test.describe('SECURITY — the admin boundary', () => {
  // Explicitly signed out: this block is about what a stranger sees.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('every admin route is 404 without a session', async ({ page }) => {
    for (const route of ADMIN_ROUTES) {
      const response = await page.goto(route);
      // §7.1: "Non-admins get 404, never 403." A 403 would confirm the panel exists.
      expect(response?.status(), `${route} should be 404`).toBe(404);
    }
  });

  test('the admin API refuses a cross-origin post but still 404s a stranger', async ({
    request,
  }) => {
    const response = await request.post('/api/admin/rates', {
      headers: { origin: 'https://evil.example' },
      data: { metal: 'GOLD', purity: 'K22_916', displayRupees: 1 },
    });

    // Authorisation runs before the origin check on admin routes, so an unauthenticated
    // caller gets 404 rather than a 403 that would confirm the route.
    expect(response.status()).toBe(404);
  });
});

test.describe('admin pages are not indexable', () => {
  test.use({ storageState: ADMIN_STATE });

  test('every admin page is noindex', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
  });
});

test.describe('the admin panel', () => {
  // Signed in once by e2e/admin.setup.ts and reused — see that file for why.
  test.use({ storageState: ADMIN_STATE });

  test('every route loads for an admin', async ({ page }) => {
    for (const route of ADMIN_ROUTES) {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should load`).toBe(200);
    }
  });

  test('the dashboard shows the rates and a shortcut to change them', async ({
    page,
  }) => {
    await page.goto('/admin');

    /**
     * §7.2: the rates shortcut belongs on the home screen because it is the most frequent
     * daily action.
     *
     * Matched exactly, not as /Update/. The loose pattern passed for months and then broke
     * the first time a rate went stale, because §7.2's "rates not updated in 48 hours" alert
     * renders its own `Update` link and the two collide under strict mode. The dashboard was
     * behaving correctly; the locator was ambiguous — the same shape as DEBT-038, where an
     * assertion written against a fresh database stopped holding once the data aged.
     */
    await expect(page.getByRole('link', { name: 'Update →' })).toBeVisible();
    await expect(page.getByText('Gold 22K')).toBeVisible();
    await expect(page.getByText('Sold today')).toBeVisible();
  });

  /**
   * The rate is global state, and these two tests both change it.
   *
   * Serial, and pinned to one viewport project: three projects running the same mutation
   * concurrently is inherently racy, and it showed up as one test reading a rate the other
   * had just moved. §7 TEST names 375px for the admin flow anyway.
   */
  test.describe.configure({ mode: 'serial' });

  test('a >20% rate change is blocked until confirmed — §7.3', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'Mutates the shared rate');
    await page.goto('/admin/rates');

    const field = page.getByLabel('New rate (per 10 grams)').first();
    const before = await field.inputValue();

    // Ten times the current rate: the fat-finger typo §7.3 calls the most damaging
    // available.
    await field.fill(String(Number(before) * 10));
    await page.getByTestId('save-K22_916').click();

    // It must not save on the first press.
    const confirm = page.getByTestId('confirm-K22_916');
    await expect(confirm).toBeVisible();
    // And the confirmation must name the size of the change, not just ask "are you sure?".
    await expect(page.getByText(/% change/)).toBeVisible();

    // Walk away rather than confirming — the rate must be untouched.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.reload();
    await expect(page.getByLabel('New rate (per 10 grams)').first()).toHaveValue(before);
  });

  /**
   * The live rate save is deliberately NOT exercised here.
   *
   * It was, and it made the suite non-deterministic: the rate is global, the storefront
   * specs read it, and Playwright runs three viewport projects in parallel — so a test that
   * raised gold for a moment intermittently failed a calculator assertion in another
   * project. Restoring the value afterwards does not close the window, and serialising one
   * file does not either, because the projects run concurrently.
   *
   * Nothing is lost by removing it. That a `setRate` reaches the storefront is proven
   * where it can be proven deterministically:
   *
   *   - `lib/rates.cache.test.ts` asserts the Redis key is busted and every rate surface is
   *     revalidated, iterating the exported constants so a missed surface fails.
   *   - Phase 4 measured it against a real production build (D-012), which is what found
   *     `revalidateTag` matching nothing in the first place.
   *
   * What stays here is the part only a browser can show: that the >20% guard blocks a save
   * until it is confirmed, and that cancelling leaves the rate untouched.
   */

  test('adding a piece shows a live price and puts it on the storefront', async ({
    page,
  }, testInfo) => {
    // Creates a row; one project is enough and three would collide on the slug.
    test.skip(testInfo.project.name !== 'mobile-375', 'Creates a product');
    const name = `E2E Test Piece ${Date.now()}`;

    await page.goto('/admin/products/new');

    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Weight').fill('10');
    await page.getByLabel('Making').fill('12');

    // §7.4: "Live price preview using calculateLine as the admin types."
    const preview = page.getByTestId('preview-total');
    await expect(preview).toBeVisible();
    const previewed = (await preview.innerText()).replace(/[^\d]/g, '');
    expect(Number(previewed)).toBeGreaterThan(0);

    await page.getByTestId('save-product').click();
    await expect(page.getByText(/Piece added/)).toBeVisible({ timeout: 10_000 });

    // It appears in the admin list…
    await page.goto('/admin/products');
    await expect(page.getByText(name)).toBeVisible();

    // …and on the storefront, at the same price the preview showed.
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const storefront = await page.goto(`/products/${slug}`);
    expect(storefront?.status()).toBe(200);

    const total = (await page.getByTestId('product-total').innerText()).replace(
      /[^\d]/g,
      '',
    );
    expect(total).toBe(previewed);
  });

  test('a category with pieces in it cannot be deleted — §7.5', async ({ page }) => {
    await page.goto('/admin/categories');

    // Rings has seeded products, so this is the blocked path.
    await page.getByRole('button', { name: /Delete Rings/i }).click();

    const error = page.getByTestId('category-error');
    await expect(error).toBeVisible();
    // The explanation must carry the count and the way out, not just "cannot delete".
    await expect(error).toContainText(/piece/);
    await expect(error).toContainText(/move them|switch this one off/i);
  });

  test('settings ask for the password again before saving — §7 SECURITY', async ({
    page,
  }) => {
    await page.goto('/admin/settings');

    await expect(page.getByText('Confirm it is you')).toBeVisible();

    const save = page.getByTestId('save-settings');
    // Disabled until a password is typed — the control is not merely advisory.
    await expect(save).toBeDisabled();

    await page.getByLabel('Your password').fill('definitely-not-the-password');
    await expect(save).toBeEnabled();
    await save.click();

    await expect(page.getByText(/did not match/)).toBeVisible({ timeout: 10_000 });
  });

  test('the audit log records what was done, read-only', async ({ page }) => {
    await page.goto('/admin/audit');

    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    // §7.10: read-only. No control on this page mutates anything.
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
  });

  test('the media page offers every slot §7.6 lists', async ({ page }) => {
    await page.goto('/admin/media');

    await expect(page.getByTestId('slot-HERO_BANNER')).toBeVisible();
    await expect(page.getByTestId('slot-FOOTER_BG')).toBeVisible();
    // Phase 8 §8.3: "Logo from a MediaSlot." §7.6's table had no logo because nothing on
    // the storefront rendered one; the invoice does. D-029.
    await expect(page.getByTestId('slot-BILL_LOGO')).toBeVisible();

    // §7.6's table: HERO_BANNER + OFFER_STRIP + 6 category tiles + FEATURE_BANNER +
    // ABOUT_IMAGE + FOOTER_BG = 11, plus Phase 8's BILL_LOGO = 12.
    await expect(page.locator('[data-testid^="slot-"]')).toHaveCount(12);
  });

  test('a media URL from a disallowed host is refused — §7.7', async ({ page }) => {
    await page.goto('/admin/media');

    const card = page.getByTestId('slot-HERO_BANNER');
    await card.getByLabel('Image URL').fill('https://evil.example/x.jpg');
    await page.getByTestId('check-HERO_BANNER').click();

    // The SSRF guard's host allowlist, reached through the real UI.
    await expect(card.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('§7 DESIGN — usable one-handed at 375px', () => {
  test.use({ storageState: ADMIN_STATE });

  test('no admin screen scrolls sideways', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'A mobile concern');

    for (const route of ADMIN_ROUTES) {
      await page.goto(route);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows, `${route} scrolls horizontally`).toBe(false);
    }
  });

  test('numeric fields ask for a numeric keyboard', async ({ page }) => {
    await page.goto('/admin/products/new');

    // §7 DESIGN: "Forms use appropriate mobile keyboards throughout."
    for (const label of ['Weight', 'Making', 'Stone / other charges']) {
      await expect(page.getByLabel(label)).toHaveAttribute('inputmode', 'decimal');
    }
  });

  test('admin nav targets meet 44px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'A mobile concern');

    await page.goto('/admin');
    const links = page.getByRole('navigation', { name: 'Admin' }).getByRole('link');

    const count = await links.count();
    expect(count).toBe(5);
    for (let i = 0; i < count; i += 1) {
      const box = await links.nth(i).boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});
