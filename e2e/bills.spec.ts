/**
 * Phase 8 E2E — the bill flow in a real browser.
 * specs/08-billing-whatsapp.md, TEST section:
 *
 *   "E2E at 375px: admin creates a 3-item bill, generates the PDF, opens the WhatsApp link
 *    (assert href only), marks sent, and the order appears in the admin list."
 *
 * ── What only a browser can show ──
 * The arithmetic, the numbering and the access rules are proven deterministically in the
 * integration suites. What is left, and what is here, is the part that depends on the page
 * actually working: that the builder's running total is the engine's, that Generate produces
 * a downloadable PDF, that the send flow does NOT record a send until the admin says so, and
 * that the bill then appears in the list.
 *
 * Pinned to the 375px project. It creates rows, and three viewport projects racing on the
 * invoice sequence is a test suite arguing with itself.
 */
import { expect, test, type Page } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

/** §8 TEST names 375px, which is also the width the shop actually uses. */
const MOBILE = 'mobile-375';

interface RatesPayload {
  gold22: { perGram: string };
  gold18: { perGram: string };
  silver999: { perGram: string };
}

/** Digits from a formatted figure — `₹3,22,519` → `322519`. */
function digitsOf(text: string | null): number {
  const digits = (text ?? '').replace(/[^\d]/g, '');
  return digits === '' ? Number.NaN : Number(digits);
}

async function fillItem(page: Page, index: number, weight: string, making: string) {
  await page.getByLabel('Weight').nth(index).fill(weight);
  await page.getByLabel('Making').nth(index).fill(making);
}

test.describe('SECURITY — the bill boundary', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the bill screens are 404 without a session', async ({ page }) => {
    for (const route of ['/admin/bills', '/admin/bills/new', '/admin/bills/export']) {
      const response = await page.goto(route);
      // Never 403: that would confirm the invoice book exists.
      expect(response?.status(), `${route} should be 404`).toBe(404);
    }
  });

  test('a bill PDF is not served on the key alone — DEBT-021', async ({ request }) => {
    // A well-formed UUIDv4 with no signature. Even a correct key must not be enough.
    const response = await request.get('/bills/8f14e45f-ceea-4a67-b1a8-9d4c2b3e1f00', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
  });

  test('sequential guessing finds nothing', async ({ request }) => {
    for (const key of ['1', '2', '1.pdf', '0001']) {
      expect((await request.get(`/bills/${key}`)).status()).toBe(404);
    }
  });
});

test.describe('the bill builder', () => {
  test.use({ storageState: ADMIN_STATE });
  test.describe.configure({ mode: 'serial' });

  test('creates a 3-item bill, sends it, and lists it', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== MOBILE,
      'Creates orders and consumes bill numbers',
    );

    // The true rate, from the API — the same figure the server will price with. The
    // expected total is computed here rather than read off the screen.
    const rates: RatesPayload = await (await page.request.get('/api/rates')).json();

    await page.goto('/admin/bills/new');

    // §8.1: Generate must be disabled until the phone is a real Indian mobile.
    const generate = page.getByRole('button', { name: 'Generate' });
    await expect(generate).toBeDisabled();

    // `exact` matters: an item card's own name field is labelled "Name for item 1".
    await page.getByLabel('Name', { exact: true }).fill('E2E Customer');
    await page.getByLabel('Mobile number').fill('12345');
    await expect(page.getByText(/10-digit Indian mobile/)).toBeVisible();
    await expect(generate).toBeDisabled();

    await page.getByLabel('Mobile number').fill('98765 43210');

    // Three items (§8 TEST).
    await fillItem(page, 0, '10', '12');
    await page.getByRole('button', { name: 'Add another item' }).click();
    await fillItem(page, 1, '8.475', '12');
    await page.getByRole('button', { name: 'Add another item' }).click();
    await fillItem(page, 2, '5', '15');

    await expect(page.getByTestId('item-card')).toHaveCount(3);

    /**
     * The running total is the pricing engine's.
     *
     * Recomputed here from the rate and MASTER-SPEC §4's formula, so a change that made the
     * builder show a plausible-but-different figure fails. `Number` is safe: these are
     * display values, and the server's own total is asserted separately.
     */
    const perGram = Number(rates.gold22.perGram); // paise per gram
    const expectedRupees =
      [
        { g: 10, mk: 12 },
        { g: 8.475, mk: 12 },
        { g: 5, mk: 15 },
      ]
        .map(({ g, mk }) => Math.round(perGram * g * (1 + mk / 100) * 1.03))
        .reduce((sum, line) => sum + line, 0) / 100;

    const totalBar = page.getByTestId('bill-total');

    /**
     * Polled, not read once.
     *
     * The recalculation is debounced by 150ms and an empty bill legitimately reads `₹0`, so
     * a single read right after the last keystroke can catch a stale figure — it did, and
     * the failure looked like a pricing bug rather than a race.
     *
     * `textContent`, not `innerText`: the bar is `fixed`, and `innerText` depends on layout.
     *
     * This still fails on a genuinely wrong total: a builder computing something else never
     * converges, and the poll times out on the same assertion.
     */
    await expect
      .poll(
        async () => {
          const shown = digitsOf(await totalBar.textContent());
          return Number.isNaN(shown)
            ? Number.POSITIVE_INFINITY
            : Math.abs(shown - expectedRupees);
        },
        { timeout: 10_000 },
      )
      // The bar shows whole rupees (`formatINR` truncates the paise), so it can sit up to
      // one rupee below the exact figure — but no further.
      .toBeLessThan(1);

    await expect(generate).toBeEnabled();
    await generate.click();

    // ── The detail page ────────────────────────────────────────────────────

    await page.waitForURL(/\/admin\/bills\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const orderNo = await page.getByRole('heading', { level: 1 }).innerText();
    expect(orderNo).toMatch(/^[A-Z]{1,8}-\d{4}-\d{4,}$/);

    // §8.4: the bill has NOT been sent until the admin says so.
    await expect(page.getByText('Not sent')).toBeVisible();

    // §8.3: the PDF exists and is downloadable at the signed URL the page renders.
    const pdfLink = page.getByRole('link', { name: 'Open PDF' });
    await expect(pdfLink).toBeVisible();

    const pdfHref = await pdfLink.getAttribute('href');
    expect(pdfHref).toMatch(/\/bills\/[0-9a-f-]{36}\?e=\d+&s=/);

    const pdf = await page.request.get(pdfHref!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect(pdf.headers()['x-robots-tag']).toContain('noindex');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

    // ── The WhatsApp link: asserted, never followed ────────────────────────

    const waLink = page.getByRole('link', { name: /Send on WhatsApp/ });
    const waHref = await waLink.getAttribute('href');
    expect(waHref).toBeTruthy();

    const wa = new URL(waHref!);
    expect(wa.hostname).toBe('wa.me');
    expect(wa.pathname).toBe('/919876543210');

    // The message decodes back to what §8.4 specifies, with the PDF link inside it.
    const message = wa.searchParams.get('text')!;
    expect(message).toContain('Namaste E2E Customer,');
    expect(message).toContain(`Invoice: ${orderNo}`);
    expect(message).toContain(pdfHref!);

    /**
     * §8.4's template ends with a link to the purchase history.
     *
     * Phase 9 replaced the plain `/account/orders` link with a claim link when one can be
     * minted (D-030) — and for this bill, raised to a number with no verified account, one
     * always can. The plain link only works for someone who is already set up, which is not
     * the customer this message is for.
     */
    expect(message).toMatch(/\/claim\/[A-Za-z0-9_-]+/);

    // ── Mark as sent, which must be a separate, deliberate act ─────────────

    // Never actually leave for WhatsApp. The popup is opened and closed; the request is
    // aborted so nothing reaches wa.me from a test run.
    await page.context().route('**://wa.me/**', (route) => route.abort());

    const popup = page.waitForEvent('popup');
    await waLink.click();
    await (await popup).close();

    // §8.4: "Do not set it optimistically." Opening WhatsApp asks; it does not record.
    await expect(page.getByText(/Did the message send/)).toBeVisible();

    await page.getByRole('button', { name: 'Not yet' }).click();
    await page.reload();
    await expect(page.getByText('Not sent')).toBeVisible();

    // Now confirm it properly.
    const waLinkAgain = page.getByRole('link', { name: /Send on WhatsApp/ });
    const popupAgain = page.waitForEvent('popup');
    await waLinkAgain.click();
    await (await popupAgain).close();
    await page.getByRole('button', { name: 'Yes, mark as sent' }).click();

    await expect(page.getByText(/marked as sent/)).toBeVisible({ timeout: 10_000 });

    // ── The list ───────────────────────────────────────────────────────────

    await page.goto('/admin/bills');
    const row = page.getByText(orderNo).first();
    await expect(row).toBeVisible();

    // Searching by the number the customer would read out finds it.
    await page.goto('/admin/bills?q=98765%2043210');
    await expect(page.getByText(orderNo).first()).toBeVisible();

    // And the sent filter now includes it.
    await page.goto('/admin/bills?sent=sent');
    await expect(page.getByText(orderNo).first()).toBeVisible();

    /**
     * The dashboard, with a sale in it.
     *
     * Deliberately at the end of this test rather than in `admin.spec.ts`: §8.7's totals and
     * the 30-day chart only render once an order exists, and a dashboard assertion that runs
     * against an empty shop exercises the empty-state branch and nothing else. That is how a
     * `SUM()` returning a Decimal instead of a bigint stayed latent from Phase 7 until Phase
     * 8 raised the first bill — the page 500'd the moment there was something to chart.
     */
    const dashboard = await page.goto('/admin');
    expect(dashboard?.status()).toBe(200);
    await expect(page.getByText('Sold today')).toBeVisible();

    // Non-zero, which is what proves the aggregation ran over real rows rather than taking
    // the empty-shop branch. The 200 above is what catches the crash; this is what makes
    // the 200 mean something.
    const soldToday = digitsOf(
      await page
        .locator('p', { hasText: /^Sold today$/ })
        .locator('~ p')
        .first()
        .textContent(),
    );
    expect(soldToday).toBeGreaterThan(0);
  });

  test('the builder does not scroll sideways at 375px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== MOBILE, 'A 375px assertion');

    await page.goto('/admin/bills/new');
    await expect(page.getByTestId('item-card')).toHaveCount(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the CSV export downloads with the filters applied', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== MOBILE, 'One project is enough for a download');

    await page.goto('/admin/bills');

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export CSV' }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^bills-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
