/**
 * Stage 5E — the invoice book, the bill, and the builder.
 *
 * Deliberately narrow, and deliberately NOT overlapping `e2e/bills.spec.ts`, which already
 * proves the thing only a full browser run can: create → PDF → WhatsApp href → mark sent →
 * appears in the list. The arithmetic, the numbering, the idempotency and the access rules
 * belong to the integration suites and are far cheaper there.
 *
 * What is here is what Stage 5E changed: that the screen answers §1's six questions, that a
 * filter can be seen and undone, that the money breaks down the same way the invoice does,
 * and that voiding says which bill it is about before it does anything.
 *
 * Nothing in this file mutates. The void confirmation is opened and dismissed; a bill is
 * never actually voided, because a voided invoice cannot be un-voided and this suite runs
 * against the same database the other specs read.
 */
import { expect, test, type Page } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

test.use({ storageState: ADMIN_STATE });

/** The first real bill in the book — not `/new`, and not the CSV export link. */
async function firstBillHref(page: Page): Promise<string> {
  await page.goto('/admin/bills');
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((links) =>
      links.map((a) => (a as HTMLAnchorElement).getAttribute('href')),
    );
  const href = hrefs.find((value) => /^\/admin\/bills\/[0-9a-f-]{36}$/.test(value ?? ''));
  expect(href, 'the fixtures guarantee at least one bill').toBeTruthy();
  return href!;
}

test.describe('the invoice book', () => {
  test('a row answers who, how much, and what state — §1', async ({ page }) => {
    await page.goto('/admin/bills');

    const row = page.getByTestId('bill-row').first();
    await expect(row).toBeVisible();

    // The identifier the shop and the customer both quote.
    await expect(row).toContainText(/[A-Z]{1,8}-\d{4}-\d{4,}/);
    // A total, with its currency.
    await expect(row).toContainText(/₹/);
    // And a customer — a name, a number, or both.
    await expect(row).toContainText(/\+91\d{10}/);
  });

  test('the page says what the totals mean — §4', async ({ page }) => {
    await page.goto('/admin/bills');
    await expect(
      page.getByText(/Totals are what the customer was charged, GST included/),
    ).toBeVisible();
  });

  test('an applied filter is visible and can be undone — §6', async ({ page }) => {
    await page.goto('/admin/bills?sent=unsent');

    await expect(page.getByRole('link', { name: /Not sent only/ })).toBeVisible();

    await page.getByRole('link', { name: 'Clear all' }).click();
    await expect(page).toHaveURL(/\/admin\/bills$/);
    await expect(page.getByRole('link', { name: /Not sent only/ })).toHaveCount(0);
  });

  test('the refinements fold away but still submit — §6', async ({ page }) => {
    await page.goto('/admin/bills');

    // Closed by default when nothing is refined, so the phone shows bills rather than
    // controls; the search box stays out in the open because that is what gets used.
    const drawer = page.locator('details');
    await expect(drawer).not.toHaveAttribute('open', '');
    await expect(page.getByLabel('Search')).toBeVisible();

    await page.getByText('More filters').click();
    await page.getByLabel('Sent', { exact: true }).selectOption('unsent');
    await page.getByRole('button', { name: 'Apply filters' }).click();

    await expect(page).toHaveURL(/sent=unsent/);
    // And arriving on a refined view, the drawer is open so the reason is visible.
    await expect(page.locator('details')).toHaveAttribute('open', '');
  });

  test('a search with no matches offers the way out — §20', async ({ page }) => {
    await page.goto('/admin/bills?q=zzzznotabill');

    await expect(page.getByText('No bills match')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/admin/bills',
    );
  });
});

test.describe('one bill', () => {
  test('the total is stated once in full, and again at the end of the charges — §9', async ({
    page,
  }) => {
    await page.goto(await firstBillHref(page));

    await expect(page.getByText('Total charged')).toBeVisible();
    // §9 asks for a breakdown ending in the total, not a bare figure.
    await expect(page.getByRole('heading', { name: 'Charges' })).toBeVisible();
    await expect(page.getByText('Taxable value').first()).toBeVisible();
    await expect(page.getByText(/CGST/)).toBeVisible();
    await expect(page.getByText(/SGST/)).toBeVisible();
  });

  test('an item shows where its money went — §8', async ({ page }) => {
    await page.goto(await firstBillHref(page));

    const items = page.getByRole('heading', { name: 'Items' }).locator('..');

    // The purity reads as it does on the invoice, not as the Prisma enum. Phase 8 rendered
    // `String(item.purity).replace('_', ' ')`, so an admin saw "K22 916".
    await expect(items).toContainText(/22K \(916\)|18K \(750\)|Silver \(999\)/);
    // Weight and the SNAPSHOTTED rate, each with its unit.
    await expect(items).toContainText(/[\d.]+ g at ₹[\d,]+\.\d{2}\/g/);
    // And the split that only the PDF used to carry.
    await expect(items).toContainText('Metal value');
  });

  test('the rate snapshot is on the screen, not only in the PDF — §7', async ({ page }) => {
    await page.goto(await firstBillHref(page));

    await expect(page.getByRole('heading', { name: 'Rates applied' })).toBeVisible();
    await expect(
      page.getByText(/frozen — changing today’s rates never changes this bill/),
    ).toBeVisible();
  });

  test('voiding names the bill and needs a reason — §19', async ({ page }) => {
    await page.goto(await firstBillHref(page));

    const orderNo = await page.getByRole('heading', { level: 1 }).innerText();

    const start = page.getByRole('button', { name: 'Void this bill' });
    // A bill that is already void has no void control, and that is correct.
    test.skip((await start.count()) === 0, 'this bill is already void');

    await start.click();

    const confirm = page.getByTestId('confirm-void');
    await expect(confirm).toContainText(orderNo);
    // The existing rule, unchanged: a reason of three characters or more.
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Reason').fill('ab');
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Reason').fill('entered twice');
    await expect(confirm).toBeEnabled();

    // Backing out must leave the invoice exactly as it was.
    await page.getByRole('button', { name: 'Keep this bill' }).click();
    await expect(page.getByTestId('confirm-void')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Void this bill' })).toBeVisible();
  });
});

test.describe('the builder', () => {
  test('shows the rate it is pricing with — §11, §13', async ({ page }) => {
    await page.goto('/admin/bills/new');

    /**
     * The panel only exists once `/api/rates` has answered, so wait for the total bar first
     * — it is fed by the same fetch and is present from the first render.
     *
     * Without this the assertion below raced the request and failed under parallel load,
     * which is exactly the shape of flake that gets "fixed" by raising a timeout. The
     * assertion itself is unchanged.
     */
    await page.getByTestId('bill-total').waitFor();
    await expect(page.getByRole('heading', { name: 'Rates being used' })).toBeVisible();
    await expect(page.getByText(/frozen onto the bill when you generate it/)).toBeVisible();
  });

  test('says why Generate is unavailable — §12', async ({ page }) => {
    await page.goto('/admin/bills/new');
    await page.getByTestId('bill-total').waitFor();

    await expect(page.getByRole('button', { name: 'Generate' })).toBeDisabled();
    await expect(page.getByText('Before this bill can be generated')).toBeVisible();
    await expect(page.getByText(/The customer’s mobile number/)).toBeVisible();

    // §12 — an incomplete bill says so in the review, not only by refusing to submit.
    await expect(page.getByTestId('bill-review')).toContainText('no mobile number yet');
  });

  test('the review reconciles with the total in the bar — §14', async ({ page }) => {
    await page.goto('/admin/bills/new');
    await page.getByTestId('bill-total').waitFor();

    await page.getByLabel('Mobile number').fill('98765 43210');
    await page.getByLabel('Weight').first().fill('12.5');
    await page.getByLabel('Making').first().fill('12');

    const bar = page.getByTestId('bill-total');
    // Debounced by 150ms, so poll rather than reading once — the lesson bills.spec.ts records.
    await expect.poll(async () => (await bar.textContent()) ?? '').not.toMatch(/—|₹0$/);

    const review = page.getByTestId('bill-review');
    await expect(review).toContainText('Metal value');
    await expect(review).toContainText('Making charges');

    /**
     * The review's total and the sticky bar's are the same figure.
     *
     * They come from the same `TotalResult`, so this is a wiring assertion rather than an
     * arithmetic one — `lib/calculator/summary.test.ts` already proves the parts reconcile
     * with the whole. What it catches is a review that quietly renders a different total
     * from the one the admin is looking at when they press Generate.
     */
    const digits = (text: string | null) => (text ?? '').replace(/[^\d]/g, '');
    const barDigits = digits(await bar.textContent());
    const reviewTotal = digits(
      await review.locator('dd').last().textContent(),
    );
    // The bar truncates the paise; the review shows them. Compare the rupee part.
    expect(reviewTotal.startsWith(barDigits)).toBe(true);

    await expect(page.getByRole('button', { name: 'Generate' })).toBeEnabled();
    // Deliberately not clicked: this spec creates nothing. bills.spec.ts owns that path.
  });
});
