/**
 * Phase 1 smoke test — acceptance criterion 1: "App builds and runs; homepage renders."
 * Created by Phase 1 (specs/01-cleanup-scaffold.md).
 *
 * Phase 2 replaces the styling assertions here with the real /__design audit; Phase 4
 * asserts the rate ticker sits above the fold at 375×667.
 */
import { expect, test } from '@playwright/test';

test('homepage renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tirupati Jewelles' })).toBeVisible();
  await expect(page.getByText('Coming soon', { exact: true })).toBeVisible();
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
