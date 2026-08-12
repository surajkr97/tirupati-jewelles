/**
 * Stage 5F — settings, collections and the audit log.
 *
 * Nothing in this file mutates. Settings cannot be saved without the admin's password by
 * design, a collection is never renamed or deleted, and no image is removed — every
 * confirmation is opened, checked and dismissed. The server-side behaviour these screens
 * drive is covered far more cheaply in `lib/admin/admin.test.ts`, which runs against a real
 * database; what is here is what only a browser shows.
 */
import { expect, test } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

test.use({ storageState: ADMIN_STATE });

test.describe('settings', () => {
  test('the settings are grouped, not one long form — §3', async ({ page }) => {
    await page.goto('/admin/settings');

    for (const group of [
      'Shop',
      'Pricing defaults',
      'Invoice numbering',
      'Homepage rate ticker',
      'Notices',
      'Confirm it is you',
    ]) {
      await expect(page.getByRole('heading', { name: group, exact: true })).toBeVisible();
    }
  });

  test('save reports whether there is anything to save — §5', async ({ page }) => {
    await page.goto('/admin/settings');

    const save = page.getByTestId('save-settings');
    await expect(save).toHaveText(/No changes/);
    await expect(save).toBeDisabled();

    await page.getByLabel('Shop name').fill('Tirupati Jewelles & Sons');
    await expect(save).toHaveText(/Save settings/);

    // §7 SECURITY — re-authentication is the point of this screen, so a change alone is not
    // enough, and the screen says which of the two is missing rather than just refusing.
    await expect(save).toBeDisabled();
    await expect(page.getByText('Enter your password above to save these changes.')).toBeVisible();

    await page.getByLabel('Your password').fill('not-the-password');
    await expect(save).toBeEnabled();
    // Deliberately not clicked: this spec writes nothing.
  });

  test('a change to GST says what it will do — §4, §6', async ({ page }) => {
    await page.goto('/admin/settings');

    // Nothing shouts before anything has been touched.
    await expect(page.getByText(/Every price on the site/)).toHaveCount(0);

    await page.getByLabel('GST', { exact: true }).fill('9');

    const warning = page.getByText(/Every price on the site/);
    await expect(warning).toBeVisible();
    // §4 — the unit is explicit, and both figures are named.
    await expect(warning).toContainText('9%');
  });

  test('a change to the invoice sequence says what it will do — §6', async ({ page }) => {
    await page.goto('/admin/settings');

    await page.getByLabel('Next invoice number').fill('3');

    await expect(page.getByText(/The next bill will be numbered/)).toBeVisible();
    // The consequence, not a generic caution.
    await expect(page.getByText(/unique for six years/)).toBeVisible();
  });

  test('the invoice number is previewed as it will read — §3', async ({ page }) => {
    await page.goto('/admin/settings');

    await page.getByLabel('Prefix').fill('TJ');
    await page.getByLabel('Next invoice number').fill('42');
    await expect(page.getByText(/TJ-\d{4}-0042/)).toBeVisible();
  });
});

test.describe('collections', () => {
  test('a row names the collection and shows its image state — §10', async ({ page }) => {
    await page.goto('/admin/categories');

    const row = page.getByTestId('category-row').first();
    await expect(row).toBeVisible();
    // The name was being squeezed out entirely at 320px before Stage 5F.
    await expect(row.getByText('Rings', { exact: true })).toBeVisible();
    await expect(row).toContainText('/rings');
    await expect(row).toContainText(/pieces/);
  });

  test('the editor exposes name, web address, image and visibility — §11', async ({
    page,
  }) => {
    await page.goto('/admin/categories');
    await page.getByRole('button', { name: /^Edit Rings$/ }).click();

    // All three of these were unreachable before Stage 5F: `saveCategory` has always taken
    // a name and a slug, and `Category.imageUrl` had no field at all (DEBT-014).
    await expect(
      page.getByRole('heading', { name: 'Collection', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('Rings');
    await expect(page.getByLabel('Web address')).toHaveValue('rings');
    await expect(page.getByRole('heading', { name: 'Image', exact: true })).toBeVisible();
    await expect(page.getByLabel('Image URL')).toBeVisible();
    await expect(page.getByRole('switch', { name: /visible on the site/i })).toBeVisible();

    // And it opens clean, so Save has nothing to do yet.
    await expect(page.getByTestId(/^save-category-/)).toHaveText(/No changes/);
  });

  test('deleting asks first and names the collection — §6', async ({ page }) => {
    await page.goto('/admin/categories');
    await page.getByRole('button', { name: /^Edit Rings$/ }).click();
    await page.getByRole('button', { name: 'Delete this collection' }).click();

    const confirm = page.locator('[data-testid^="delete-confirm-"]');
    await expect(confirm).toContainText('Rings');
    // Rings has pieces in it, so the confirmation says what will actually happen.
    await expect(confirm).toContainText(/refused/);

    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.locator('[data-testid^="delete-confirm-"]')).toHaveCount(0);
  });

  test('removing an image asks first and names the collection — §12', async ({ page }) => {
    await page.goto('/admin/categories');
    await page.getByRole('button', { name: /^Edit Rings$/ }).click();

    const remove = page.getByRole('button', { name: 'Remove image' }).first();
    test.skip((await remove.count()) === 0, 'Rings has no image in this database');

    await remove.click();
    const confirm = page.locator('[data-testid^="remove-image-confirm-"]');
    await expect(confirm).toContainText('Rings');
    await expect(confirm).toContainText(/branded frame/);

    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.locator('[data-testid^="remove-image-confirm-"]')).toHaveCount(0);
  });
});

test.describe('the audit log', () => {
  test('says it is a record, and offers nothing that would change one — §17', async ({
    page,
  }) => {
    await page.goto('/admin/audit');

    await expect(page.getByText(/entries cannot be edited or removed/)).toBeVisible();

    for (const name of [/delete/i, /edit/i, /clear history/i, /remove/i]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
  });

  test('a row answers what, who and when — §13', async ({ page }) => {
    await page.goto('/admin/audit');

    const row = page.getByTestId('audit-row').first();
    await expect(row).toBeVisible();

    // §14 — a readable label AND the stored event name, because renaming the event was
    // never on the table.
    await expect(row).toContainText(/[A-Z][A-Z0-9_]{4,}/);
    await expect(row).toContainText(/\d{1,2} \w{3} \d{4}/);
  });

  test('filtering does not shrink the list of things to filter by — §15', async ({
    page,
  }) => {
    await page.goto('/admin/audit');
    const all = await page
      .getByLabel('Action')
      .locator('option')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));

    expect(all.length).toBeGreaterThan(2);

    /**
     * Phase 7 built both dropdowns from the rows currently on screen, so filtering to one
     * action left that action as the only option and there was no way back except editing
     * the URL. The vocabulary now comes from the whole table.
     */
    await page.goto('/admin/audit?action=RATE_SET');
    const afterFilter = await page
      .getByLabel('Action')
      .locator('option')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));

    expect(afterFilter).toEqual(all);
  });

  test('an active filter is visible and removable — §15', async ({ page }) => {
    await page.goto('/admin/audit?action=RATE_SET');

    await expect(page.getByRole('link', { name: /Rate changed/ })).toBeVisible();

    await page.getByRole('link', { name: 'Clear all' }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(page.getByRole('link', { name: /Rate changed/ })).toHaveCount(0);
  });

  test('the history is paged rather than poured into the browser — §18', async ({
    page,
  }) => {
    await page.goto('/admin/audit');

    const rows = await page.getByTestId('audit-row').count();
    expect(rows).toBeLessThanOrEqual(50);

    // With more than one page, the pager exists and says where you are.
    const pager = page.getByRole('navigation', { name: 'Audit pages' });
    if (await pager.count()) {
      await expect(pager).toContainText(/Page 1 of/);
      await expect(pager.getByRole('link', { name: 'Older' })).toBeVisible();
    }
  });
});
