/**
 * Stage 5D — admin products and media.
 *
 * Deliberately narrow. The pricing engine, the SSRF guard, the upload signature, the soft
 * delete and the audit writes are covered by `lib/admin/admin.test.ts` and
 * `lib/media/*.test.ts`, which can reach them far more cheaply than a browser can. What is
 * here is the part only a browser can show: that the screen tells the truth about a piece,
 * that a filter can be seen and undone, and that the two destructive actions on these
 * screens ask before they act.
 */
import { expect, test } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

test.use({ storageState: ADMIN_STATE });

test.describe('the catalogue list', () => {
  test('a row identifies the piece: image, purity, weight, price, status', async ({
    page,
  }) => {
    // A seeded piece with photographs and a known purity.
    await page.goto('/admin/products?q=temple');

    const row = page.locator('li', { hasText: 'Temple Necklace Set' }).first();
    await expect(row).toBeVisible();

    // §2 — the image. Phase 7 counted the images without ever selecting one, so this list
    // was a column of text describing jewellery.
    await expect(row.locator('[data-image-frame] img')).toBeVisible();

    await expect(row).toContainText('Gold 22K');
    // §10 — the weight carries its unit, in the piece's own stored precision.
    await expect(row).toContainText(/48\.500\s*g/);
    await expect(row).toContainText(/₹/);
  });

  test('the price is labelled, never a bare figure — §10', async ({ page }) => {
    await page.goto('/admin/products');
    // The explanation governs the column: what the number is, and what is in it.
    await expect(page.getByText(/Prices are today’s.*including.*GST/)).toBeVisible();
  });

  test('an applied filter is visible and can be undone — §3', async ({ page }) => {
    await page.goto('/admin/products?status=hidden');

    // The active state, in words rather than only as a `<select>` value.
    const pill = page.getByRole('link', { name: /Hidden only/ });
    await expect(pill).toBeVisible();

    await page.getByRole('link', { name: 'Clear all' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    await expect(page.getByRole('link', { name: /Hidden only/ })).toHaveCount(0);
  });

  test('a search with no matches offers the way out — §21', async ({ page }) => {
    await page.goto('/admin/products?q=zzzznotathing');

    await expect(page.getByText('No pieces match those filters')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/admin/products',
    );
  });
});

test.describe('the product editor', () => {
  async function openFirstPiece(page: import('@playwright/test').Page) {
    await page.goto('/admin/products');
    await page
      .locator('a[href^="/admin/products/"]:not([href$="/new"])')
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  }

  test('save is inert until something changes, then it is not — §12', async ({ page }) => {
    await openFirstPiece(page);

    const save = page.getByTestId('save-product');
    await expect(save).toHaveText(/No changes/);
    await expect(save).toBeDisabled();

    await page.getByLabel('Name').fill('Renamed in a test, never saved');
    await expect(save).toHaveText(/Save changes/);
    await expect(save).toBeEnabled();
  });

  test('the fields are grouped, and each says what it wants — §8, §9', async ({ page }) => {
    await page.goto('/admin/products/new');

    for (const group of ['Identity', 'The piece', 'Pricing', 'Availability']) {
      await expect(page.getByRole('heading', { name: group })).toBeVisible();
    }

    // §9 — the unit and the range, reachable by a screen reader rather than living in an
    // `aria-hidden` suffix.
    await expect(page.getByText('In grams, up to 3 decimal places.')).toBeVisible();
    await expect(page.getByText('0–100% of the metal value.')).toBeVisible();
  });

  test('removing a photo asks first, and names it — §20', async ({ page }) => {
    await page.goto('/admin/products?q=temple');
    await page
      .locator('a[href^="/admin/products/"]:not([href$="/new"])')
      .first()
      .click();

    // §19 — which photograph the shop leads with.
    const gallery = page.getByRole('list').filter({ hasText: 'Cover' }).first();
    await expect(gallery.getByText('Cover')).toBeVisible();

    await page.getByRole('button', { name: 'Remove photo 1' }).click();

    const confirm = page.getByTestId('remove-confirm-0');
    // Not "Are you sure?" — which photograph, by position and by its own alt text.
    await expect(confirm).toContainText(/Remove photo 1/);
    await expect(confirm.getByTestId('confirm-remove-0')).toBeVisible();

    // And backing out leaves the gallery exactly as it was.
    await page.getByRole('button', { name: 'Keep' }).click();
    await expect(page.getByTestId('remove-confirm-0')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove photo 1' })).toBeVisible();
  });
});

test.describe('the media screen', () => {
  test('separates what is on the site from what is not — §15', async ({ page }) => {
    await page.goto('/admin/media');

    await expect(page.getByRole('heading', { name: 'On the site now' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Not shown anywhere yet' }),
    ).toBeVisible();

    // The hero and the invoice logo are the two the application actually reads.
    await expect(page.getByTestId('slot-HERO_BANNER')).toContainText(
      'The big image at the top of the homepage',
    );
    await expect(page.getByTestId('slot-BILL_LOGO')).toContainText(
      'The top of every bill PDF',
    );

    // And the ones that are read by nothing no longer name a place on the site. The about
    // page in particular has never existed — see specs/ROUTE-MAP.md.
    await expect(page.getByTestId('slot-ABOUT_IMAGE')).toContainText(
      'Not shown on the site yet',
    );
    await expect(page.getByTestId('slot-FOOTER_BG')).toContainText(
      'Not shown on the site yet',
    );

    // §7.6's table is still complete; only its description changed.
    await expect(page.locator('[data-testid^="slot-"]')).toHaveCount(12);
  });

  test('clearing an image asks first, and names the slot — §20', async ({ page }) => {
    await page.goto('/admin/media');

    const hero = page.getByTestId('slot-HERO_BANNER');
    await hero.getByRole('button', { name: 'Clear' }).click();

    const confirm = page.getByTestId('confirm-clear-HERO_BANNER');
    await expect(confirm).toBeVisible();
    await expect(hero).toContainText('Clear the Homepage hero image?');

    // Backing out must leave the live homepage image alone.
    await hero.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByTestId('confirm-clear-HERO_BANNER')).toHaveCount(0);
    await expect(hero.locator('[data-image-frame] img')).toBeVisible();
  });

  test('save stays quiet until a slot is edited — §12', async ({ page }) => {
    await page.goto('/admin/media');

    const save = page.getByTestId('save-HERO_BANNER');
    await expect(save).toHaveText(/No changes/);
    await expect(save).toBeDisabled();

    await page.getByTestId('slot-HERO_BANNER').getByLabel('Headline').fill('Typed');
    await expect(save).toHaveText(/^Save$/);
    await expect(save).toBeEnabled();
  });
});
