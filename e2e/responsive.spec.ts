/**
 * Stage 2 — the shell at every width the brief names.
 *
 * `playwright.config.ts` fixes three projects (375 / 768 / 1280) because the assertions in
 * the other suites are about behaviour, not about width. The redesign brief names eight
 * widths and requires "ZERO horizontal overflow at 320px", which is narrower than anything
 * this repository had ever measured — the config's smallest project is 375.
 *
 * So this file drives the viewport itself and runs in ONE project. Iterating eight widths
 * inside three projects would be twenty-four runs of the same measurement.
 *
 * ── What horizontal overflow actually is ──
 *
 * `documentElement.scrollWidth > innerWidth` means the page can be scrolled sideways, which
 * on a phone means a column of text runs off the screen. The 1px tolerance absorbs Chromium's
 * fractional layout geometry — the same float error `admin.spec.ts` documents for tap targets,
 * where a 44px control measured 43.99993896484375.
 */
import { expect, test } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

/** Every width in brief §15. 320 is the floor and the one that had never been checked. */
const WIDTHS = [320, 360, 390, 414, 768, 1024, 1280, 1440] as const;

const TAP_MIN = 44 - 0.01;

/**
 * Public routes that render the storefront shell.
 *
 * Split by width on purpose. Horizontal overflow is a NARROW-viewport failure — every
 * instance found so far (the rates table at 320, the header's Enquire button at 320/360)
 * appeared at the bottom of the range and had disappeared by 375. So the full route list is
 * checked where overflow actually happens, and only the two most complex pages are carried
 * across the wide widths.
 *
 * This is a deliberate trim. The first version loaded all six routes at all eight widths —
 * 48 navigations in one describe — and the added contention pushed three long-running tests
 * in OTHER specs (`seo`, `admin`, `bills`) past their 30s timeout under four workers. Buying
 * near-zero coverage with other suites' reliability is a bad trade.
 */
const NARROW_WIDTHS = [320, 360, 390, 414] as const;
const ALL_ROUTES = ['/', '/rates', '/calculator', '/collections', '/search', '/login'];
/** The two densest pages — a data table and a live widget — carried across every width. */
const WIDE_ROUTES = ['/', '/rates'];

/**
 * Can the page actually be scrolled sideways?
 *
 * This attempts the scroll rather than comparing widths, because on `/rates` the two
 * disagreed: `documentElement.scrollWidth` reported 341 in a 320px viewport while
 * `document.body.scrollWidth` reported 320. Only trying it settles which is true — it was,
 * and the cause was thirteen absolutely-positioned `.sr-only` nodes escaping a scroll
 * container that was not itself positioned.
 *
 * The widths come back too, as diagnostics in the failure message.
 */
async function horizontalScroll(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const startX = window.scrollX;
    window.scrollTo(9999, window.scrollY);
    const reached = window.scrollX;
    window.scrollTo(startX, window.scrollY);

    const limit = document.documentElement.clientWidth;
    let culprit: string | null = null;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const rect = el.getBoundingClientRect();
      if (rect.right > limit + 1 || rect.left < -1) {
        culprit = `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 80)}`;
        break;
      }
    }

    return {
      scrolledBy: reached,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      culprit,
    };
  });
}

test.describe('no horizontal overflow', () => {
  // One project's worth — the viewport is set per test below.
  test.beforeEach(({}, testInfo) => {
    /**
     * Runs under the plain Desktop Chrome project, not `mobile-375`.
     *
     * That project sets `isMobile: true`, which pins a device layout viewport —
     * `setViewportSize(320)` then resizes the visual viewport while layout continues at 375,
     * and every measurement is against the wrong width. Driving an un-emulated context makes
     * the numbers mean what they say.
     */
    test.skip(testInfo.project.name !== 'desktop-1280', 'viewport is driven explicitly here');
  });

  for (const width of WIDTHS) {
    test(`storefront fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });

      const routes = (NARROW_WIDTHS as readonly number[]).includes(width)
        ? ALL_ROUTES
        : WIDE_ROUTES;

      for (const route of routes) {
        await page.goto(route);
        /**
         * The header, not `networkidle`.
         *
         * `waitForLoadState('networkidle')` never settles against the DEV server that
         * `playwright.config.ts` deliberately runs — the HMR websocket keeps a connection
         * open, so six routes in one test blew the 30s budget. Waiting for the shell to
         * paint is both faster and a truthful readiness signal for a layout measurement.
         */
        await page.locator('header').first().waitFor({ state: 'visible' });

        const m = await horizontalScroll(page);
        expect(
          m.scrolledBy,
          `${route} at ${width}px scrolls sideways by ${m.scrolledBy}px ` +
            `(doc ${m.docScrollWidth} / body ${m.bodyScrollWidth} / viewport ${m.innerWidth}) ` +
            `— first element past the edge: ${m.culprit}`,
        ).toBe(0);
      }
    });
  }

  test(`the 404 fits at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/this-route-does-not-exist');

    const m = await horizontalScroll(page);
    expect(m.scrolledBy, `the 404 scrolls sideways — ${m.culprit}`).toBe(0);
  });
});

test.describe('the header holds together across the breakpoint', () => {
  test.beforeEach(({}, testInfo) => {
    /**
     * Runs under the plain Desktop Chrome project, not `mobile-375`.
     *
     * That project sets `isMobile: true`, which pins a device layout viewport —
     * `setViewportSize(320)` then resizes the visual viewport while layout continues at 375,
     * and every measurement is against the wrong width. Driving an un-emulated context makes
     * the numbers mean what they say.
     */
    test.skip(testInfo.project.name !== 'desktop-1280', 'viewport is driven explicitly here');
  });

  for (const width of WIDTHS) {
    test(`header controls stay 44px and inside the viewport at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');

      const header = page.locator('header').first();
      await expect(header).toBeVisible();

      // Below md the menu button is the way in; at and above it, the nav is inline.
      const control =
        width < 768
          ? page.getByRole('button', { name: 'Open menu' })
          : page
              .getByRole('navigation', { name: 'Main' })
              .getByRole('link', { name: 'Rates', exact: true });

      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.height, `control height at ${width}px`).toBeGreaterThanOrEqual(TAP_MIN);
      expect(box!.x, `control starts inside the viewport at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(
        box!.x + box!.width,
        `control ends inside the viewport at ${width}px`,
      ).toBeLessThanOrEqual(width + 1);

      // The wordmark must never be pushed out by the controls beside it.
      const wordmark = page.getByRole('link', { name: 'Tirupati Jewelles — home' });
      const wordmarkBox = await wordmark.boundingBox();
      expect(wordmarkBox!.x, `wordmark visible at ${width}px`).toBeGreaterThanOrEqual(0);
    });
  }
});

test.describe('the bottom nav at the narrowest widths', () => {
  test.beforeEach(({}, testInfo) => {
    /**
     * Runs under the plain Desktop Chrome project, not `mobile-375`.
     *
     * That project sets `isMobile: true`, which pins a device layout viewport —
     * `setViewportSize(320)` then resizes the visual viewport while layout continues at 375,
     * and every measurement is against the wrong width. Driving an un-emulated context makes
     * the numbers mean what they say.
     */
    test.skip(testInfo.project.name !== 'desktop-1280', 'viewport is driven explicitly here');
  });

  // Five items in 320px is 64px each — the tightest the design ever gets.
  for (const width of [320, 360, 390, 414] as const) {
    test(`five destinations fit and stay tappable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');

      // 'Primary' is BottomNav's landmark; the header's desktop nav is 'Main'.
      const nav = page.getByRole('navigation', { name: 'Primary' });
      const links = nav.getByRole('link');
      await expect(links).toHaveCount(5);

      for (const link of await links.all()) {
        const box = await link.boundingBox();
        // Width may be under 44 at 320px — the ROW is 64px tall, which is what carries the
        // target. Height is the assertion that matters; labels must not be clipped away.
        expect(box!.height, `nav item height at ${width}px`).toBeGreaterThanOrEqual(TAP_MIN);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
        expect(box!.width, `nav item has width at ${width}px`).toBeGreaterThan(0);
        await expect(link).toBeVisible();
      }
    });
  }
});

test.describe('the admin shell across the breakpoint', () => {
  test.use({ storageState: ADMIN_STATE });
  test.beforeEach(({}, testInfo) => {
    /**
     * Runs under the plain Desktop Chrome project, not `mobile-375`.
     *
     * That project sets `isMobile: true`, which pins a device layout viewport —
     * `setViewportSize(320)` then resizes the visual viewport while layout continues at 375,
     * and every measurement is against the wrong width. Driving an un-emulated context makes
     * the numbers mean what they say.
     */
    test.skip(testInfo.project.name !== 'desktop-1280', 'viewport is driven explicitly here');
  });

  for (const width of WIDTHS) {
    test(`/admin fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/admin');
      await page.locator('header').first().waitFor({ state: 'visible' });

      const m = await horizontalScroll(page);
      expect(
        m.scrolledBy,
        `/admin at ${width}px scrolls sideways by ${m.scrolledBy}px — ${m.culprit}`,
      ).toBe(0);

      // The rail appears at md and not before; below it, the bottom bar is the navigation.
      const rail = page.locator('nav[aria-label="Admin"]').first();
      if (width >= 768) {
        await expect(rail).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: 'More admin pages' })).toBeVisible();
      }
    });
  }
});
