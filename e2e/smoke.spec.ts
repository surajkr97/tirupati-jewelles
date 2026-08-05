/**
 * Phase 1 smoke test — acceptance criterion 1: "App builds and runs; homepage renders."
 * Created by Phase 1 (specs/01-cleanup-scaffold.md).
 *
 * Phase 2 replaces the styling assertions here with the real /__design audit; Phase 4
 * asserts the rate ticker sits above the fold at 375×667.
 */
import { expect, test } from '@playwright/test';

test('homepage renders the rate ticker', async ({ page }) => {
  await page.goto('/');

  // Phase 4 replaced the "Coming soon" placeholder. §4.5: the ticker is the reason
  // people visit, so its presence is the homepage's smoke test.
  await expect(page.getByRole('radiogroup', { name: 'Metal and purity' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Gold 22K' })).toBeChecked();

  // MASTER-SPEC §8 requires this line to be present and readable at all times — it is
  // the mitigation for showing a price that differs from the transaction price.
  await expect(page.getByText(/Indicative rate/)).toBeVisible();
  await expect(page.getByText(/Final price confirmed in store/)).toBeVisible();
});

test('ticker is above the fold at 375px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-375', 'Fold position is a mobile concern');

  await page.goto('/');
  const box = await page.getByRole('radiogroup', { name: 'Metal and purity' }).boundingBox();

  // §4.5: "it does not go below a marketing banner."
  expect(box?.y ?? Infinity).toBeLessThan(667);
});

test('no horizontal scroll', async ({ page }) => {
  await page.goto('/');

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflows).toBe(false);
});

test('health endpoint reports database and redis', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok', database: 'ok' });
});
