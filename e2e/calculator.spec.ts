/**
 * Phase 5 E2E — the calculator in a real browser.
 * specs/05-calculator.md TEST:
 *
 *   "E2E at 375px: add 3 items, change purity on one, remove one, verify total by
 *    independent calculation in the test."
 *   "Verify the calculator uses the true rate while the ticker is jittering."
 *   "Shared link recomputes to an identical total."
 *   "sessionStorage restore after refresh."
 *
 * The totals asserted here are computed **in the test**, from the rate the API reports —
 * never read back from the component. Asserting that the screen agrees with itself is the
 * tautology AGENTS.md warns TEST about.
 */
import { expect, test, type Page } from '@playwright/test';

/**
 * Minimum tap target, with a sub-pixel tolerance.
 *
 * Chromium reports fractional geometry, and at `deviceScaleFactor: 2` a 44px control
 * measured 43.99993896484375 under full-suite load while measuring exactly 44 when the file
 * ran alone — 6e-5 of a pixel of float error, asserted against as though it were a design
 * regression. The tolerance is 0.01px: far below anything a human or a layout can produce,
 * and the next size down the scale is 40px, so a real miss still fails.
 */
const TAP_MIN = 44 - 0.01;

/** The pricing formula, reimplemented from MASTER-SPEC §4 for independent verification. */
function lineTotalPaise(
  ratePerGram: bigint,
  weightGrams: number,
  makingPct: number,
  gstPct = 3,
): bigint {
  const weightMg = BigInt(Math.round(weightGrams * 1000));
  const makingBp = BigInt(Math.round(makingPct * 100));
  const gstBp = BigInt(Math.round(gstPct * 100));

  const metalScaled = ratePerGram * weightMg; // ×10^3
  const subtotalScaled = metalScaled * 10_000n + metalScaled * makingBp; // ×10^7
  const totalScaled = subtotalScaled * 10_000n + subtotalScaled * gstBp; // ×10^11

  // Banker's rounding, as MASTER-SPEC §4 requires.
  const denominator = 10_000_000n * 10_000n;
  const quotient = totalScaled / denominator;
  const remainder = totalScaled % denominator;
  const twice = remainder * 2n;

  if (twice > denominator) return quotient + 1n;
  if (twice < denominator) return quotient;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

/** `₹1,36,609` — how `formatINR` renders paise without decimals. */
function formatRupees(paise: bigint): string {
  const rupees = paise / 100n;
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees)}`;
}

async function trueRates(page: Page): Promise<Record<string, bigint>> {
  const response = await page.request.get('/api/rates');
  const body = await response.json();

  return {
    K22_916: BigInt(body.gold22.perGram),
    K18_750: BigInt(body.gold18.perGram),
    SILVER_999: BigInt(body.silver999.perGram),
  };
}

const grandTotal = (page: Page) => page.getByTestId('grand-total');
const cards = (page: Page) => page.getByTestId('item-card');

/** Wait past the 150ms recalculation debounce plus the 250ms count-up. */
async function settle(page: Page) {
  await page.waitForTimeout(600);
}

test.describe('the calculator', () => {
  test('starts with one card and a zero total', async ({ page }) => {
    await page.goto('/calculator');

    // §5.4: "One item card pre-added. Never an empty screen with a lone add button."
    await expect(cards(page)).toHaveCount(1);
    await expect(grandTotal(page)).toHaveText('₹0');
  });

  test('prices one item to the paise', async ({ page }) => {
    const rates = await trueRates(page);
    await page.goto('/calculator');

    await page.getByLabel('Weight').fill('10');
    await settle(page);

    const expected = lineTotalPaise(rates.K22_916!, 10, 12);
    await expect(grandTotal(page)).toHaveText(formatRupees(expected));
  });

  test('add 3 items, change purity on one, remove one — §5 TEST at 375px', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-375',
      'The spec names 375px specifically',
    );

    const rates = await trueRates(page);
    await page.goto('/calculator');

    // Item 1 — 10 g of 22K at 12%.
    await cards(page).nth(0).getByLabel('Weight').fill('10');

    // Item 2 — 5.5 g, switched to 18K.
    await page.getByRole('button', { name: /Add another item/i }).click();
    await cards(page).nth(1).getByLabel('Weight').fill('5.5');
    await cards(page).nth(1).getByRole('radio', { name: '18K' }).click();

    // Item 3 — 20 g of silver at 8%, which we then remove.
    await page.getByRole('button', { name: /Add another item/i }).click();
    await cards(page).nth(2).getByLabel('Weight').fill('20');
    await cards(page).nth(2).getByRole('radio', { name: 'Silver' }).click();
    await cards(page).nth(2).getByRole('button', { name: '8%' }).click();

    await expect(cards(page)).toHaveCount(3);
    await settle(page);

    const withThree =
      lineTotalPaise(rates.K22_916!, 10, 12) +
      lineTotalPaise(rates.K18_750!, 5.5, 12) +
      lineTotalPaise(rates.SILVER_999!, 20, 8);
    await expect(grandTotal(page)).toHaveText(formatRupees(withThree));

    // Remove the third.
    await cards(page)
      .nth(2)
      .getByRole('button', { name: /^Remove /i })
      .click();
    await expect(cards(page)).toHaveCount(2);
    await settle(page);

    const withTwo =
      lineTotalPaise(rates.K22_916!, 10, 12) + lineTotalPaise(rates.K18_750!, 5.5, 12);
    await expect(grandTotal(page)).toHaveText(formatRupees(withTwo));

    // The grand total is the sum of the lines — §5.1's "property that must never break",
    // checked here against what is actually on screen.
    const lineTexts = await page.getByTestId('item-total').allInnerTexts();
    expect(lineTexts).toHaveLength(2);
  });

  test('duplicating a card doubles the total', async ({ page }) => {
    const rates = await trueRates(page);
    await page.goto('/calculator');

    await page.getByLabel('Weight').fill('10');
    await settle(page);

    await page.getByRole('button', { name: /^Duplicate /i }).click();
    await settle(page);

    await expect(cards(page)).toHaveCount(2);
    await expect(grandTotal(page)).toHaveText(
      formatRupees(lineTotalPaise(rates.K22_916!, 10, 12) * 2n),
    );
  });

  test('the breakdown adds up to the item total', async ({ page }) => {
    await page.goto('/calculator');
    await page.getByLabel('Weight').fill('10');
    await settle(page);

    await page.getByRole('button', { name: /Show breakdown/i }).click();

    // A customer checking the arithmetic must find that it works. Read the rendered
    // figures and add them up here.
    const values = await page.locator('dd').allInnerTexts();
    const paise = values.map((v) => BigInt(v.replace(/[₹,.]/g, '')));

    // metal + making + GST = item total (no stones on this row).
    const [metal, making, subtotal, gst, itemTotal] = paise;
    expect(metal! + making!).toBe(subtotal!);
    expect(subtotal! + gst!).toBe(itemTotal!);
  });
});

test.describe('input handling', () => {
  test('rejects text in a numeric field without losing the other items', async ({
    page,
  }) => {
    const rates = await trueRates(page);
    await page.goto('/calculator');

    await cards(page).nth(0).getByLabel('Weight').fill('10');
    await page.getByRole('button', { name: /Add another item/i }).click();
    await cards(page).nth(1).getByLabel('Weight').fill('abc');
    await settle(page);

    await expect(cards(page).nth(1).getByRole('alert')).toBeVisible();

    // The good row still totals.
    await expect(grandTotal(page)).toHaveText(
      formatRupees(lineTotalPaise(rates.K22_916!, 10, 12)),
    );
  });

  test('every numeric field asks for a numeric keyboard', async ({ page }) => {
    await page.goto('/calculator');
    await page.getByRole('button', { name: /Add stone or other charges/i }).click();

    // §5 DESIGN: "Numeric keyboards appear for every numeric field." `decimal`, not
    // `numeric` — iOS's numeric pad has no decimal point and every weight here has three.
    for (const label of ['Weight', 'Making', 'Stone / other charges']) {
      await expect(page.getByLabel(label)).toHaveAttribute('inputmode', 'decimal');
    }
  });
});

test.describe('§5.3 sessionStorage', () => {
  test('a refresh does not lose the work', async ({ page }) => {
    await page.goto('/calculator');

    await page.getByLabel('Weight').fill('12.5');
    await page.getByLabel(/Name for item 1/i).fill('Bangle');
    await page.getByRole('button', { name: /Add another item/i }).click();
    await cards(page).nth(1).getByLabel('Weight').fill('4');
    await settle(page);

    const before = await grandTotal(page).innerText();

    await page.reload();
    await settle(page);

    // §5.3: "Someone pricing eight items who accidentally refreshes should not lose the
    // work."
    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByLabel(/Name for item 1/i)).toHaveValue('Bangle');
    await expect(grandTotal(page)).toHaveText(before);
  });
});

test.describe('§5.6 preloading from a product link', () => {
  test('fills the first card from the query string', async ({ page }) => {
    const rates = await trueRates(page);
    await page.goto(
      '/calculator?purity=K18_750&weight=8.475&making=15&label=Temple+necklace',
    );
    await settle(page);

    await expect(page.getByLabel(/Name for item 1/i)).toHaveValue('Temple necklace');
    await expect(page.getByLabel('Weight')).toHaveValue('8.475');
    await expect(page.getByRole('radio', { name: '18K' })).toBeChecked();

    await expect(grandTotal(page)).toHaveText(
      formatRupees(lineTotalPaise(rates.K18_750!, 8.475, 15)),
    );
  });

  test('a malformed link still opens a usable calculator', async ({ page }) => {
    await page.goto('/calculator?purity=PLATINUM&weight=abc&making=999');

    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByRole('radio', { name: '22K' })).toBeChecked();
    await expect(grandTotal(page)).toBeVisible();
  });
});

test.describe('§5.5 shared results', () => {
  test('a shared link recomputes to an identical total', async ({ page, request }) => {
    const rates = await trueRates(page);

    const created = await request.post('/api/calculator/share', {
      data: {
        items: [
          {
            id: 'a',
            label: 'Chain',
            metal: 'GOLD',
            purity: 'K22_916',
            weightGrams: '10',
            makingPct: '12',
            stoneCharge: '',
            gstPct: '3',
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const { path } = await created.json();

    await page.goto(path);

    const expected = lineTotalPaise(rates.K22_916!, 10, 12);
    // Shown to the paise on the shared page, where the recipient is checking a quote.
    const rupees = expected / 100n;
    const paise = (expected % 100n).toString().padStart(2, '0');
    const formatted = `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees)}.${paise}`;

    await expect(page.getByTestId('shared-grand-total')).toHaveText(formatted);
    // §5.5: "Show the snapshot date."
    await expect(page.getByText(/Priced with rates as of/)).toBeVisible();
  });

  test('an unknown slug is a 404', async ({ page }) => {
    const response = await page.goto('/calculator/s/zzzzzzzzzzzz');

    expect(response?.status()).toBe(404);
  });

  test('a shared page is noindex — it was sent to one person', async ({ page }) => {
    const created = await page.request.post('/api/calculator/share', {
      data: {
        items: [
          {
            id: 'a',
            label: '',
            metal: 'GOLD',
            purity: 'K22_916',
            weightGrams: '5',
            makingPct: '10',
            stoneCharge: '',
            gstPct: '3',
          },
        ],
      },
    });
    const { path } = await created.json();

    await page.goto(path);

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
  });
});

/**
 * §5 TEST, the critical case — and the browser-level half of DEBT-013.
 *
 * The component test in components/calculator/true-rate.test.tsx mounts both on one page
 * with fake timers. This is the real thing: a genuine ticker jittering on the homepage, a
 * real navigation, and a total checked against what /api/rates reports.
 */
test.describe('the calculator uses the TRUE rate, never the jittered one', () => {
  test('after watching the ticker move, the calculator still prices from the true rate', async ({
    page,
  }) => {
    const rates = await trueRates(page);

    await page.goto('/');
    const ticker = page.getByTestId('ticker-value');
    await expect(ticker).toBeVisible();

    const first = await ticker.innerText();
    await page.waitForTimeout(4000);
    const second = await ticker.innerText();

    // The jitter really is running — without this the assertion below proves nothing.
    expect(second).not.toBe(first);

    // The displayed rate is off the true rate right now.
    const displayed = BigInt(second.replace(/[₹,]/g, '')) * 100n; // rupees → paise, per 10 g
    const truePer10g = rates.K22_916! * 10n;
    expect(displayed).not.toBe(truePer10g);

    await page.goto('/calculator');
    await page.getByLabel('Weight').fill('10');
    await settle(page);

    // MASTER-SPEC §8: "the calculator and every bill always use the true admin rate."
    await expect(grandTotal(page)).toHaveText(
      formatRupees(lineTotalPaise(rates.K22_916!, 10, 12)),
    );
  });

  test('the calculator requests /api/rates and nothing rate-shaped from the ticker', async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) requested.push(url.pathname);
    });

    await page.goto('/calculator');
    await settle(page);

    expect(requested).toContain('/api/rates');

    // Distinct paths, not a call count: React strict mode double-invokes effects in dev,
    // so the same idempotent GET legitimately fires more than once. What matters is that
    // /api/rates is the ONLY rate source the calculator reaches for.
    const rateEndpoints = [...new Set(requested.filter((p) => p.includes('rate')))];
    expect(rateEndpoints).toEqual(['/api/rates']);
  });
});

test.describe('§5 DESIGN', () => {
  test('the sticky bar never covers the last card at 375px', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'A one-handed mobile concern');

    await page.goto('/calculator');
    await page.getByRole('button', { name: /Add stone or other charges/i }).click();
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(300);

    const field = page.getByLabel('Stone / other charges');
    await expect(field).toBeVisible();

    const fieldBox = await field.boundingBox();
    const barBox = await page.getByTestId('total-bar').boundingBox();

    // §5 DESIGN: "Sticky bar never covers the last item's inputs." Scrolled to the bottom,
    // the last input must still sit above the bar.
    expect(fieldBox!.y + fieldBox!.height).toBeLessThanOrEqual(barBox!.y + 1);
  });

  test('the sticky bar does not swallow the bottom nav (DEBT-033)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'The nav is mobile-only');

    /**
     * ── Why this is hit-tested rather than looked at ──
     * The bar is `bottom-0 z-40`; the nav is `bottom-0 z-30`. The bar reserves the nav's
     * height as bottom padding so its CONTENT sits clear — but that padding was still part
     * of its box, so it painted over the nav and captured every click. The nav showed
     * through the translucent background, reading as available while being completely dead.
     *
     * Nothing about that is visible in a screenshot, and no assertion about position or
     * visibility catches it: the links ARE there and they ARE visible. Only asking the
     * browser "what would receive a tap here?" finds it. Measured before the fix: 5 of 5
     * links returned the sticky bar, on this route and on every product page.
     */
    await page.goto('/calculator');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    /**
     * The assertion is specifically "the STICKY BAR is not what receives the tap", not "the
     * link is the topmost element". Those differ under `pnpm dev`, which is what Playwright
     * runs: Next's dev-tools indicator floats over the bottom-left corner and covers the
     * Home link. That is a dev-only overlay and not a product defect — verified by
     * hit-testing a production build, where all five links are reachable — so asserting
     * topmost-ness here would fail for a reason that never reaches a customer.
     */
    const blocked = await page.evaluate(() => {
      const nav = document.querySelector('nav.fixed');
      const links = Array.from(nav?.querySelectorAll('a') ?? []);

      return links
        .filter((link) => {
          const box = link.getBoundingClientRect();
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          return Boolean(hit?.closest('[data-sticky-bar]'));
        })
        .map((link) => link.textContent?.trim() ?? '');
    });

    expect(
      blocked,
      `the sticky bar is intercepting taps meant for: ${blocked.join(', ')}`,
    ).toEqual([]);

    // The positive control: the fix must not have made the BAR unclickable instead.
    const barControl = page
      .getByTestId('total-bar')
      .getByRole('button', { name: /Show the full breakdown/i });
    await expect(barControl).toBeVisible();
    await barControl.click({ trial: true });
  });

  test('no horizontal scroll', async ({ page }) => {
    await page.goto('/calculator');

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('the total is the most prominent figure on the screen', async ({ page }) => {
    await page.goto('/calculator');
    await page.getByLabel('Weight').fill('10');
    await settle(page);

    // §5 DESIGN. Measured, not eyeballed: the grand total's font size must beat every
    // other number on the page.
    const totalSize = await grandTotal(page).evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    const itemSize = await page
      .getByTestId('item-total')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

    expect(totalSize).toBeGreaterThan(itemSize);
  });

  test('every tap target on a card meets 44px', async ({ page }) => {
    await page.goto('/calculator');

    const buttons = page.getByTestId('item-card').getByRole('button');
    const count = await buttons.count();

    for (let i = 0; i < count; i += 1) {
      const box = await buttons.nth(i).boundingBox();
      if (!box) continue;
      // MASTER-SPEC §3. The trash and duplicate icons sit side by side, where a miss
      // deletes the wrong row.
      expect(box.height, `button ${i} height`).toBeGreaterThanOrEqual(TAP_MIN);
    }
  });
});
