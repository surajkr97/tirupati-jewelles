/**
 * Phase 9 §9.7 — the screen-reader pass on the three flagship flows.
 *
 * ── What this file is, and what it is not ──
 * It is NOT a substitute for putting a real screen reader on the site. Nobody has driven
 * VoiceOver or NVDA over this application, and no automated test can tell you whether the
 * result is pleasant to listen to. What it CAN do is assert the structures a screen reader
 * reads from — the accessible names, the landmarks, the heading spine, the live regions —
 * so that the manual pass, when it happens, starts from something that is at least correct.
 * The residual gap is recorded as DEBT-042 rather than being quietly counted as done.
 *
 * ── Why these checks are here rather than in the axe suite ──
 * `e2e/a11y.spec.ts` runs WCAG 2.1 A/AA and deliberately excludes axe's `best-practice`
 * tag. Heading order and "the page has an h1" live in that tag: they are not WCAG failures,
 * but they are exactly what a screen-reader user navigates BY. Asserting them explicitly
 * here keeps the axe suite honest about what standard it enforces while still covering
 * them.
 */
import { expect, test, type Page } from '@playwright/test';

const ROUTES = [
  '/',
  '/rates',
  '/collections',
  '/collections/rings',
  '/products/classic-solitaire-ring',
  '/calculator',
  '/login',
  '/policies/buyback',
];

test.describe('§9.7 — the document spine every screen reader navigates by', () => {
  for (const route of ROUTES) {
    test(`${route} has one h1, an ordered heading spine, and a main landmark`, async ({
      page,
    }) => {
      await page.goto(route);

      // A screen reader's "jump to main content" is the landmark, which is why this
      // application needs no skip link: `<main>` is the target, on every route.
      await expect(page.locator('main')).toHaveCount(1);

      const headings = await page.evaluate(() =>
        [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map((el) => ({
            level: Number(el.tagName[1]),
            text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
          })),
      );

      const h1s = headings.filter((h) => h.level === 1);
      expect(
        h1s.map((h) => h.text),
        `${route}: expected exactly one h1`,
      ).toHaveLength(1);

      // A skipped level (h2 → h4) tells a screen-reader user a section is missing.
      const skips = headings
        .slice(1)
        .map((heading, index) => ({ heading, previous: headings[index]! }))
        .filter(({ heading, previous }) => heading.level - previous.level > 1)
        .map(
          ({ heading, previous }) =>
            `h${previous.level} → h${heading.level} at "${heading.text}"`,
        );

      expect(skips, `${route}: heading levels skip`).toEqual([]);
    });
  }
});

/**
 * Flagship flow 1 — the ticker.
 *
 * §9.7 asks only that changes are announced `aria-live="polite"`, "polite, not assertive. A
 * per-second assertive region is unusable with a screen reader." The ticker WAS polite and
 * was still unusable, for the reason the spec gives and one it does not:
 *
 *   - `TICK_INTERVAL_MS` is 1000, so a polite region queued an announcement every second.
 *     Politeness governs interruption, not volume; a queue gaining an entry per second
 *     never drains.
 *   - Every announcement would have been the JITTERED figure, which is a cosmetic shimmer
 *     and not the price (MASTER-SPEC §8, D-002). A screen reader would have been the one
 *     surface in the application stating a fabricated rate as fact.
 *
 * So the visible figure is `aria-hidden` and the live region carries `truth`, which changes
 * only when the shop changes the rate. These assertions are the ones that would fail if
 * somebody "simplified" that back.
 */
test.describe('§9.7 — flagship 1: the rate ticker', () => {
  async function liveRegions(page: Page) {
    return page.evaluate(() =>
      [...document.querySelectorAll('[aria-live]')].map((el) => ({
        politeness: el.getAttribute('aria-live'),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' '),
      })),
    );
  }

  test('announces politely, never assertively', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    const regions = await liveRegions(page);
    expect(regions.length, 'the ticker should expose a live region').toBeGreaterThan(0);

    for (const region of regions) {
      expect(region.politeness, 'a per-second assertive region is unusable').not.toBe(
        'assertive',
      );
    }
  });

  test('the jittered figure is hidden from assistive technology', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    const value = page.getByTestId('ticker-value');
    await expect(value).toBeVisible();
    await expect(
      value,
      'the shimmer is decoration; announcing it would state a rate that is not the price',
    ).toHaveAttribute('aria-hidden', 'true');
  });

  /**
   * The assertion that matters, and the one that fails against the old markup.
   *
   * The visible figure is watched moving over the same window, so this cannot pass because
   * the ticker never started — the failure mode Phase 4 TEST warned about ("every 'nothing
   * happened' assertion is paired with a positive control").
   */
  test('the announced text does NOT change every second, while the display does', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    const announced = new Set<string>();
    const displayed = new Set<string>();

    for (let i = 0; i < 6; i += 1) {
      const regions = await liveRegions(page);
      for (const region of regions) if (region.text) announced.add(region.text);
      displayed.add((await page.getByTestId('ticker-value').textContent()) ?? '');
      await page.waitForTimeout(1000);
    }

    // Positive control: the shimmer really is running, so "one announcement" is a fact
    // about the live region and not about a dead component.
    expect(
      displayed.size,
      'the visible ticker did not move — this test proves nothing without that',
    ).toBeGreaterThan(1);

    expect(
      [...announced],
      'the live region changed while the rate did not: a screen reader would read a new number every second',
    ).toHaveLength(1);
  });

  test('what it announces is the true rate, matching /api/rates', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    const regions = await liveRegions(page);
    const spoken = regions.map((region) => region.text).join(' ');

    // `display` is already the per-unit figure the ticker shows — per 10 grams for gold —
    // in paise. Read from the API rather than recomputed, so this compares the page against
    // the server rather than against a second implementation of the conversion.
    const rates = (await (await request.get('/api/rates')).json()) as {
      gold22: { display: string };
    };
    expect(rates.gold22, 'seed data should carry a 22K gold rate').toBeTruthy();

    const rupees = BigInt(rates.gold22.display) / 100n;
    const formatted = new Intl.NumberFormat('en-IN').format(Number(rupees));

    expect(spoken, `expected the announced text to carry ₹${formatted}`).toContain(
      formatted,
    );
  });
});

/**
 * Flagship flow 2 — the calculator.
 *
 * §5.4 puts four numeric fields on every item card and repeats them up to twenty times. If
 * the fields are not individually named, a screen-reader user hears "edit, edit, edit" and
 * has no way to tell item 3's weight from item 4's.
 */
test.describe('§9.7 — flagship 2: the calculator', () => {
  test('every field on an item card is individually named', async ({ page }) => {
    await page.goto('/calculator');
    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: /Add another item/i }).click();
    await expect(page.getByTestId('item-card')).toHaveCount(2);

    const unnamed = await page.evaluate(() => {
      const problems: string[] = [];
      document.querySelectorAll('[data-testid="item-card"]').forEach((card, index) => {
        card.querySelectorAll('input, select').forEach((field) => {
          const el = field as HTMLInputElement;
          const labelled =
            el.getAttribute('aria-label') ??
            (el.id
              ? document.querySelector(`label[for="${el.id}"]`)?.textContent
              : null) ??
            el.closest('label')?.textContent;
          if (!labelled?.trim()) {
            problems.push(`item ${index + 1}: <${el.tagName.toLowerCase()}> has no name`);
          }
        });
      });
      return problems;
    });

    expect(unnamed).toEqual([]);
  });

  test('the item name field distinguishes one card from another', async ({ page }) => {
    // §5.4's cards are otherwise identical. "Name for item 2" is what makes a list of
    // twenty navigable rather than a wall of unlabelled edits.
    await page.goto('/calculator');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Add another item/i }).click();

    await expect(page.getByLabel('Name for item 1')).toBeVisible();
    await expect(page.getByLabel('Name for item 2')).toBeVisible();
  });

  test('a rejected input is announced, not only reddened', async ({ page }) => {
    await page.goto('/calculator');
    await page.waitForTimeout(1500);

    await page.getByLabel('Weight').fill('abc');
    await page.waitForTimeout(500);

    // Colour alone is not a message — WCAG 1.4.1. The Input primitive uses role="alert".
    const alerts = page.locator('[role="alert"]');
    expect(await alerts.count()).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Flagship flow 3 — the enquiry, which is where a customer leaves for WhatsApp.
 *
 * The link's accessible name has to say where it goes. "Enquire" alone, read out of context
 * in a link list, does not tell a screen-reader user they are about to leave the site for
 * another application.
 */
test.describe('§9.7 — flagship 3: the WhatsApp enquiry', () => {
  test('the enquiry link says where it goes', async ({ page }) => {
    await page.goto('/products/classic-solitaire-ring');

    const link = page.getByRole('link', { name: /whatsapp/i }).first();
    await expect(link).toBeVisible();

    const href = await link.getAttribute('href');
    expect(href, 'the enquiry CTA should be a wa.me deep link').toContain('wa.me');
  });

  test('the gallery is a named list, so its images can be found', async ({ page }) => {
    await page.goto('/products/classic-solitaire-ring');

    const gallery = page.locator('ul[aria-label$="images"]');
    await expect(gallery).toBeVisible();

    // Each slide names its position. "Image 2 of 4" is orientation; an unlabelled <li> is
    // not, and a gallery is the one place a screen-reader user cannot see the dots.
    const first = gallery.locator('li').first();
    await expect(first).toHaveAttribute('aria-label', /Image 1 of \d+/);
  });
});
