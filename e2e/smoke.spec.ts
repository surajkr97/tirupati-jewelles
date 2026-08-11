/**
 * Phase 1 smoke test — acceptance criterion 1: "App builds and runs; homepage renders."
 * Created by Phase 1 (specs/01-cleanup-scaffold.md).
 *
 * Phase 2 replaces the styling assertions here with the real /__design audit; Phase 4
 * asserts the rate ticker sits above the fold at 375×667.
 */
import { expect, test } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

test('homepage renders the rate ticker', async ({ page }) => {
  await page.goto('/');

  /**
   * §4.5: the rate card is the reason people visit, so its presence is the homepage's
   * smoke test.
   *
   * Stage 4B removed the metal toggle this used to assert on — all three rates are now on
   * screen at once, so there is no selection to make. Asserting the three labels is a
   * stronger check than asserting a radiogroup was: it proves the information is present,
   * not merely that a control to reach it exists.
   */
  await expect(page.getByTestId('rate-ticker')).toBeVisible();
  for (const label of ['Gold 22K (916)', 'Gold 18K', 'Silver 999']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  // MASTER-SPEC §8 requires this line to be present and readable at all times — it is
  // the mitigation for showing a price that differs from the transaction price.
  await expect(page.getByText(/Indicative rate/)).toBeVisible();
  await expect(page.getByText(/Final price confirmed in store/)).toBeVisible();
});

test('ticker is above the fold at 375px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-375', 'Fold position is a mobile concern');

  await page.goto('/');
  const box = await page.getByTestId('rate-ticker').boundingBox();

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

  /**
   * 200 and `database: 'ok'` is the health question. `status` is NOT asserted to be `ok`
   * any more, and that is a correction rather than a loosening (§9.4).
   *
   * The field used to mean "Postgres answered". It now summarises four checks, one of which
   * is "has anyone set a rate in the last 24 hours" — a business signal, deliberately, since
   * no uptime service can see it. On a development database whose rates are a few days old
   * the honest answer is `degraded`, and asserting `ok` would have made this test fail with
   * the clock rather than with the code. That is DEBT-040's exact pattern, avoided here by
   * asserting the thing the test is named for.
   *
   * `checks.database` is what tells a load balancer to pull the instance; `status` is what
   * an alert rule reads.
   */
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    database: 'ok',
    checks: { database: { status: 'ok' } },
  });
});

/**
 * SEC-041 — the health endpoint tells a stranger less than it tells an admin.
 *
 * The per-check `status` fields stay public: §9.4 built this so one external uptime rule can
 * watch all four alert conditions, and DEBT-047's registered check reads exactly those. The
 * free-text `detail` does not — `last set 81h ago` and `cleanup.expire_shares has 143
 * waiting` describe how the shop is doing and what its internals are called, and buy an
 * uptime checker nothing.
 *
 * Both halves are asserted, because "no detail for anyone" would pass the anonymous test
 * while silently removing the field whoever is on call actually needs.
 */
test('SEC-041 — an anonymous caller gets statuses but no diagnostic detail', async ({
  request,
}) => {
  const body = await (await request.get('/api/health')).json();

  const checks = Object.entries(body.checks as Record<string, Record<string, unknown>>);
  expect(checks.length).toBeGreaterThan(0);

  for (const [name, check] of checks) {
    // The alert rule's field is still there …
    expect(check.status, `${name} must still report a status`).toBeTruthy();
    // … and the free text is not.
    expect(
      check,
      `${name} must not leak detail to an anonymous caller`,
    ).not.toHaveProperty('detail');
  }
});

test('SEC-041 — an admin still sees the detail', async ({ browser }) => {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  try {
    const body = await (await context.request.get('/api/health')).json();
    const checks = Object.values(body.checks as Record<string, Record<string, unknown>>);

    /**
     * At least one check carries detail on any real database — `rates` reports how long ago
     * a rate was set whether it is stale or fresh. Asserting "some" rather than a specific
     * one keeps this from failing with the clock, which is DEBT-040's pattern.
     */
    expect(
      checks.some((check) => typeof check.detail === 'string'),
      'an admin session must see the diagnostic detail',
    ).toBe(true);
  } finally {
    await context.close();
  }
});
