/**
 * Phase 4 E2E — the ticker's browser-level behaviour and the /rates page.
 * specs/04-rates-ticker.md, TEST section.
 *
 * Written from the phase's acceptance criteria, not from the component. The three
 * criteria that can only be checked in a real browser are:
 *
 *   2. "Ticker animates convincingly, clamped, colour-correct."
 *   4. "Off-switch works."
 *   6. "No layout shift, no timer leaks."
 *
 * The jitter maths is proven exhaustively in lib/ticker-jitter.test.ts (10,000 ticks) and
 * the timer lifecycle in components/rates/rate-ticker.test.tsx. What is left for a browser
 * is whether the wiring — env flag, OS motion preference, layout — actually holds.
 */
import { expect, test, type Page } from '@playwright/test';

import { JITTER_OFF_URL } from '../playwright.config';

/** The big number on the ticker card. */
function tickerValue(page: Page) {
  return page.getByTestId('ticker-value');
}

/**
 * Sample the displayed value once a second.
 *
 * Polls rather than diffs the endpoints, because a jitter that wandered away and happened
 * to land back on the true rate at second 10 would pass a first-vs-last comparison.
 */
async function sample(page: Page, seconds: number): Promise<string[]> {
  /**
   * Polled twice a second rather than once, because the ticker moves every 3s since Stage 6
   * (`TICK_INTERVAL_MS`) and a 6-sample-at-1s window covered barely one tick — the positive
   * control below started failing for a reason that had nothing to do with the off-switch.
   * The `seconds` argument still means wall-clock seconds.
   */
  const seen: string[] = [];
  for (let i = 0; i < seconds * 2; i += 1) {
    seen.push((await tickerValue(page).innerText()).trim());
    await page.waitForTimeout(500);
  }
  return seen;
}

test.describe('ticker jitter — the off-switch', () => {
  /**
   * The positive control.
   *
   * Without it, "the value stayed constant" proves nothing: a broken selector, a ticker
   * that never mounted, or a hydration failure would all produce a constant value and a
   * green test. This asserts the harness can see movement before the other two assert its
   * absence.
   */
  test('jitter ON: the displayed value moves within a few seconds', async ({ page }) => {
    await page.goto('/');
    await expect(tickerValue(page)).toBeVisible();

    // 13s covers several 3s ticks with room for scheduling slack.
    const seen = await sample(page, 13);
    expect(new Set(seen).size).toBeGreaterThan(1);
  });

  test('jitter OFF: the value is constant across 10s', async ({ page }) => {
    // A separate server compiled with NEXT_PUBLIC_TICKER_JITTER=false — the flag is
    // inlined at build time and cannot be flipped from here (playwright.config.ts).
    await page.goto(`${JITTER_OFF_URL}/`);
    await expect(tickerValue(page)).toBeVisible();

    const seen = await sample(page, 10);
    expect(new Set(seen).size).toBe(1);
  });

  test('jitter OFF: still shows a real rate, not a zero or a skeleton', async ({
    page,
  }) => {
    // §4.3: the first paint must already show real numbers. An off-switch that ships a
    // blank card is not an off-switch.
    await page.goto(`${JITTER_OFF_URL}/`);
    await expect(tickerValue(page)).toHaveText(/^₹[1-9][\d,]*$/);
  });
});

test.describe('ticker jitter — reduced motion', () => {
  /**
   * §4.3: "prefers-reduced-motion → no jitter at all, static true rate." The global CSS
   * override in globals.css kills animations but cannot stop a setInterval, so this has to
   * be a JS check, and the only honest way to make it is to ask a real browser.
   *
   * `page.emulateMedia()`, not `test.use({ reducedMotion: 'reduce' })`. The context option
   * silently did not take effect against these projects — a probe found
   * `matchMedia('(prefers-reduced-motion: reduce)').matches === false` inside a describe
   * that had set it, which would have made this test assert nothing while passing. Called
   * before `goto` so the value is already correct when the effect first runs.
   */
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('the browser really is reporting the preference', async ({ page }) => {
    await page.goto('/');

    // Guards the assertion below. Without it, a future Playwright change that breaks the
    // emulation turns "no jitter" into a green test that proves nothing.
    const reduced = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(reduced).toBe(true);
  });

  test('no jitter at all, even with the flag on', async ({ page }) => {
    await page.goto('/');
    await expect(tickerValue(page)).toBeVisible();

    const seen = await sample(page, 10);
    expect(new Set(seen).size).toBe(1);
  });
});

test.describe('ticker — layout', () => {
  test('the jitter does not shift the layout', async ({ page }) => {
    await page.goto('/');

    const card = page.getByTestId('rate-ticker');
    await expect(card).toBeVisible();

    /**
     * §4 TEST asks for "CLS ≈ 0" on the toggle. Measured as the card's own geometry rather
     * than through the web-vitals API: the number that matters is whether the card resizes
     * and pushes the page around, and tabular numerals plus a translate-animated thumb are
     * exactly what is supposed to prevent it.
     *
     * Document coordinates, not `boundingBox()`. Playwright's bounding box is relative to
     * the viewport, and it auto-scrolls an element into view before clicking it — so at
     * 1280px, where the hero pushes the card below the fold, the click alone reported a
     * 521px "shift" that no user would ever see. Adding the scroll offset measures the
     * thing the criterion is actually about.
     */
    const geometry = () =>
      card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return {
          top: box.top + window.scrollY,
          left: box.left + window.scrollX,
          width: box.width,
          height: box.height,
        };
      });

    const before = await geometry();

    /**
     * Stage 4B removed the metal toggle, so the shift this measured on a CLICK is now
     * measured across the JITTER instead — which is the same criterion against the thing
     * that still changes. Three seconds is three ticks; tabular numerals are what stop
     * ₹1,49,999 → ₹1,50,001 resizing the card.
     */
    await page.waitForTimeout(3000);

    const after = await geometry();

    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
  });

  test('every metal, its unit and its rate are visible at once', async ({ page }) => {
    await page.goto('/');

    // The anchor keeps the full unit; §8 requires units never to be hidden.
    await expect(page.getByTestId('ticker-unit')).toHaveText('per 10 grams');

    // What the toggle used to require an interaction to reveal is now simply on screen.
    for (const label of ['Gold 22K (916)', 'Gold 18K', 'Silver 999']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    for (const unit of ['10 g', '1 kg']) {
      await expect(page.getByText(unit, { exact: true })).toBeVisible();
    }
  });
});

test.describe('/rates page — §4.6', () => {
  test('shows all three rates', async ({ page }) => {
    await page.goto('/rates');

    // One h1 named this, not two — the card's own label is omitted here precisely so this
    // locator stays unambiguous. See `heading` in live-rate-card.tsx.
    await expect(
      page.getByRole('heading', { name: /Today.s rates/, level: 1 }),
    ).toBeVisible();

    /**
     * Scoped to the card. The history table below it has its own metal selector carrying
     * the same three labels, so an unscoped locator matches twice — legitimately, since
     * they are two different controls for two different things.
     */
    const card = page.getByTestId('rate-ticker');
    for (const label of ['Gold 22K (916)', 'Gold 18K', 'Silver 999']) {
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('carries a prominent "rates last updated" line', async ({ page }) => {
    await page.goto('/rates');
    await expect(page.getByText(/Rates last updated/)).toBeVisible();
  });

  test('carries the same disclaimer as the ticker card', async ({ page }) => {
    await page.goto('/rates');

    // MASTER-SPEC §8 — the disclaimer is the mitigation for showing an indicative price,
    // and §4.6 requires /rates to carry it too. One per card.
    await expect(page.getByText(/Indicative rate/).first()).toBeVisible();
    // One card now, so one disclaimer — it used to be one per metal card. §4.6 requires the
    // page to carry it, not to carry it three times.
    await expect(page.getByText(/Final price confirmed in store/)).toHaveCount(1);
  });

  test('history section renders and switches metal', async ({ page }) => {
    await page.goto('/rates');

    const group = page.getByRole('radiogroup', { name: 'History for metal and purity' });
    await expect(group).toBeVisible();

    await group.getByRole('radio', { name: 'Silver 999' }).click();
    await expect(group.getByRole('radio', { name: 'Silver 999' })).toBeChecked();
  });

  test('no horizontal scroll', async ({ page }) => {
    await page.goto('/rates');

    // The history table can be wide; it must scroll inside its own box rather than
    // pushing the document sideways at 375px.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test('the Rates tab in the bottom nav reaches this page', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'Bottom nav is mobile-only');

    await page.goto('/');
    await page.getByRole('navigation', { name: 'Primary' }).getByText('Rates').click();

    await expect(page).toHaveURL(/\/rates$/);
    await expect(
      page.getByRole('heading', { name: /Today.s rates/, level: 1 }),
    ).toBeVisible();
  });
});

test.describe('/api/rates/history — §4.2', () => {
  test('returns points for a valid metal and purity', async ({ request }) => {
    const response = await request.get(
      '/api/rates/history?metal=GOLD&purity=K22_916&days=30',
    );

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({ metal: 'GOLD', purity: 'K22_916', days: 30 });
    expect(Array.isArray(body.points)).toBe(true);

    // Money crosses the wire as a string, never a JSON number — MASTER-SPEC §4.
    for (const point of body.points) {
      expect(typeof point.rate).toBe('string');
    }
  });

  test.describe('malformed input is rejected, not coerced', () => {
    const cases = [
      ['no parameters', ''],
      ['unknown metal', '?metal=PLATINUM&purity=K22_916'],
      ['unknown purity', '?metal=GOLD&purity=K24'],
      ['purity that does not belong to the metal', '?metal=GOLD&purity=SILVER_999'],
      ['days below the floor', '?metal=GOLD&purity=K22_916&days=0'],
      ['days above the ceiling', '?metal=GOLD&purity=K22_916&days=9999'],
      ['days not a number', '?metal=GOLD&purity=K22_916&days=abc'],
      ['negative days', '?metal=GOLD&purity=K22_916&days=-7'],
    ] as const;

    for (const [name, query] of cases) {
      test(name, async ({ request }) => {
        const response = await request.get(`/api/rates/history${query}`);
        expect(response.status()).toBe(400);
      });
    }
  });
});

/**
 * Phase 4 SECURITY, over real HTTP against a running server.
 *
 * The unit suite in app/api/admin/rates/route.test.ts mocks the guard so it can vary the
 * caller's role. These do not mock anything — they check that an anonymous request across
 * the wire really is refused, which is the claim that matters.
 */
test.describe('SECURITY — the client cannot set a rate', () => {
  test('POST /api/admin/rates is 404 without a session', async ({ request }) => {
    const response = await request.post('/api/admin/rates', {
      data: { metal: 'GOLD', purity: 'K22_916', displayRupees: 1 },
    });

    // 404, never 403 — a 403 confirms the route is there (§3.6).
    expect(response.status()).toBe(404);
  });

  test('the rate is unchanged after an anonymous attempt', async ({ request }) => {
    const before = await (await request.get('/api/rates')).json();

    await request.post('/api/admin/rates', {
      data: { metal: 'GOLD', purity: 'K22_916', displayRupees: 1 },
    });

    const after = await (await request.get('/api/rates')).json();
    expect(after.gold22.perGram).toBe(before.gold22.perGram);
  });

  for (const route of ['/api/rates', '/api/rates/history']) {
    test(`${route} refuses a POST — it is read-only`, async ({ request }) => {
      const response = await request.post(route, { data: { displayRupees: 1 } });

      // MASTER-SPEC §8 and the price-tampering control: "Client never sends a rate."
      // These two routes export only GET, so anything else must not reach a handler.
      expect(response.status()).toBe(405);
    });
  }
});
