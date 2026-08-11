/**
 * Phase 9 §9.7 — "Full keyboard navigation."
 *
 * axe cannot answer this one. It can see that a control has an accessible name; it cannot
 * see whether you can REACH the control, whether you can tell where you are, or whether you
 * can get back out. Those are the three questions here, and all three are asked by driving
 * the real keyboard rather than by reading markup:
 *
 *   1. Reach     — every interactive element on a page is a tab stop.
 *   2. See       — the focused element has a visible indicator, computed, not assumed.
 *   3. Escape    — no element traps focus; you can always tab past it.
 *
 * Phase 2 already proved the Sheet's focus trap TRAPS (which is correct for a modal). This
 * file is about the rest of the application, where a trap would be a defect.
 */
import { expect, test, type Page } from '@playwright/test';

/** The flows MASTER-SPEC §1 calls flagship, plus the two screens with the most controls. */
const ROUTES = [
  '/',
  '/rates',
  '/collections/rings',
  '/products/classic-solitaire-ring',
  '/calculator',
  '/login',
];

/**
 * Everything a keyboard user is entitled to reach.
 *
 * `:not([disabled])` and `[tabindex]:not([tabindex="-1"])` matter: a disabled control is
 * correctly skipped, and -1 means "focusable by script, not by Tab", which is what the
 * Sheet's container uses.
 */
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

/**
 * Stamp every rendered focusable element with an index, and describe it.
 *
 * Identity matters more than it looks: two adjacent icon buttons produce identical tag and
 * class strings, so comparing those would report a false trap the moment a page has a pair
 * of them — which the item card does, deliberately (§5 DESIGN: "the trash and duplicate
 * icons sit adjacent"). The stamp gives each element a name that is its own.
 */
async function stampFocusable(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const rendered = [...document.querySelectorAll(selector)].filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // Only what is actually rendered: a control inside a closed sheet is not a gap.
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    });

    return rendered.map((el, index) => {
      el.setAttribute('data-kb', String(index));
      // The element's shadow AT REST, captured before anything is focused. The focus test
      // compares against this rather than against "none", because a Card already carries
      // `shadow-card` and would otherwise look permanently focused.
      el.setAttribute('data-kb-shadow', getComputedStyle(el).boxShadow);
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40);
      return `${index}:${el.tagName.toLowerCase()}${label ? `[${label}]` : ''}`;
    });
  }, FOCUSABLE);
}

/**
 * Tab through the document and collect the stamps that actually received focus.
 *
 * It does NOT stop when focus reaches the document boundary. A form that autofocuses an
 * input — `/login` does — starts the traversal in the middle of the page, so everything
 * above it is only reachable after focus wraps around. Stopping at the boundary reported
 * those as unreachable, which is the harness describing itself rather than the page.
 */
async function tabThrough(page: Page, limit: number): Promise<Set<string>> {
  const seen = new Set<string>();

  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press('Tab');
    const stamp = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-kb'),
    );
    if (typeof stamp === 'string') seen.add(stamp);
  }

  return seen;
}

test.describe('§9.7 — every control is reachable', () => {
  for (const route of ROUTES) {
    test(`${route} — Tab reaches every interactive element`, async ({ page }) => {
      await page.goto(route);
      // The ticker and the calculator both hydrate before their controls are live.
      await page.waitForTimeout(1500);

      const rendered = await stampFocusable(page);

      // Generous headroom — the assertion is "everything was reached", not an exact
      // sequence, because focus leaves for the browser chrome and comes back around.
      const reached = await tabThrough(page, rendered.length * 2 + 10);

      const missed = rendered.filter((_, index) => !reached.has(String(index)));

      expect(
        missed,
        `${route}: ${rendered.length} focusable elements rendered; these never received focus`,
      ).toEqual([]);
    });
  }
});

test.describe('§9.7 — focus is always visible', () => {
  /**
   * A focus ring that is invisible is the same as no keyboard support: you can move, but
   * you cannot tell where you are. Measured from computed style — `outline`, `box-shadow`
   * (which is what Tailwind's `ring-*` compiles to) or a border change all count.
   *
   * `:focus-visible`, not `:focus`, is what the design system uses, so this drives real Tab
   * presses rather than calling `.focus()` — a scripted focus does not always match
   * `:focus-visible` and the test would pass on a rule that never fires for a user.
   */
  for (const route of ROUTES) {
    test(`${route} — the focused element is visibly marked`, async ({ page }) => {
      await page.goto(route);
      await page.waitForTimeout(1500);

      const rendered = await stampFocusable(page);
      const unmarked: string[] = [];

      for (let i = 0; i < rendered.length * 2 + 10; i += 1) {
        await page.keyboard.press('Tab');
        const result = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          // Only elements this run stamped. Anything else is the document boundary or a
          // control that appeared after stamping, and neither is what is under test —
          // scoring them mis-attributed every one to index 0, which is the site logo.
          const stamp = el?.getAttribute('data-kb');
          if (!el || stamp === null || stamp === undefined) return null;

          const style = getComputedStyle(el);
          const hasOutline =
            style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
          // Tailwind's `ring-*` compiles to box-shadow, which is what this design system
          // uses where the global outline is suppressed. Compared against the element's own
          // resting shadow, captured before the run — an inherited `shadow-card` would
          // otherwise read as a focus indicator on every card in the page.
          const hasRing =
            style.boxShadow !== 'none' &&
            style.boxShadow !== el.getAttribute('data-kb-shadow');

          return { marked: hasOutline || hasRing, stamp };
        });

        if (result === null) continue;
        if (!result.marked) {
          const name = rendered[Number(result.stamp)] ?? `(unknown ${result.stamp})`;
          if (!unmarked.includes(name)) unmarked.push(name);
        }
      }

      expect(unmarked, `${route}: focused with no visible indicator`).toEqual([]);
    });
  }
});

test.describe('§9.7 — nothing traps the keyboard outside a modal', () => {
  /**
   * A trap is invisible until someone hits it: Tab stops advancing and the only way out is
   * the mouse. Detected by tabbing well past the number of controls on the page and
   * checking that focus kept MOVING rather than sticking to one element.
   */
  for (const route of ROUTES) {
    test(`${route} — focus keeps moving`, async ({ page }) => {
      await page.goto(route);
      await page.waitForTimeout(1500);

      const rendered = await stampFocusable(page);

      let previous: string | null | undefined;
      let stuck = 0;
      let worst = '';

      for (let i = 0; i < rendered.length * 2 + 10; i += 1) {
        await page.keyboard.press('Tab');
        const current = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return undefined;
          return el.getAttribute('data-kb');
        });

        if (current !== undefined && current === previous) {
          stuck += 1;
          worst = rendered[Number(current)] ?? String(current);
        } else {
          stuck = 0;
        }
        // Three consecutive presses landing on the same element is a trap; two can happen
        // legitimately at the document boundary as focus leaves for the browser chrome.
        expect(stuck, `${route}: focus stuck on ${worst}`).toBeLessThan(3);
        previous = current;
      }
    });
  }
});

test.describe('§9.7 — the segmented control follows the radiogroup pattern', () => {
  /**
   * The unselected options are `tabindex="-1"` ON PURPOSE. A radiogroup takes ONE tab stop
   * and the arrow keys move within it — the roving-tabindex pattern — so a keyboard user
   * tabbing past a metal switcher takes one press instead of three.
   *
   * That is correct, and it is also indistinguishable from "two controls are unreachable"
   * unless something checks the arrow keys actually work. The first version of the reach
   * test above reported exactly that, wrongly. So the substitute is asserted directly:
   * reach the group with Tab, then change the selection without touching the mouse.
   */
  test('one tab stop, and the arrow keys move the selection', async ({ page }) => {
    /**
     * `/rates`, not `/`.
     *
     * This test is about the `SegmentedControl` primitive's radiogroup keyboard contract,
     * not about the homepage. Stage 4B removed the homepage's metal switcher — all three
     * rates are on screen at once now — but the control itself is unchanged and still used
     * by the rate-history selector here, the calculator and the catalogue filters.
     */
    await page.goto('/rates');
    await page.waitForTimeout(1500);

    const group = page.getByRole('radiogroup', { name: /metal/i });
    await expect(group).toBeVisible();

    const options = group.getByRole('radio');
    await expect(options).toHaveCount(3);

    // Exactly one of the three is in the tab order at any time.
    const tabbable = await options.evaluateAll(
      (els) => els.filter((el) => el.getAttribute('tabindex') !== '-1').length,
    );
    expect(tabbable, 'a radiogroup takes one tab stop, not three').toBe(1);

    await options.first().focus();
    await expect(options.first()).toBeChecked();

    await page.keyboard.press('ArrowRight');
    await expect(
      options.nth(1),
      'ArrowRight must move the selection — it is the only way in',
    ).toBeChecked();

    await page.keyboard.press('ArrowLeft');
    await expect(options.first()).toBeChecked();
  });
});

test.describe('§9.7 — the product gallery is operable without a mouse', () => {
  /**
   * The regression test for the `scrollable-region-focusable` violation §9.7 found.
   *
   * The gallery is a horizontally scrolling list with no focusable children, so before the
   * fix a keyboard user could reach the product page and never see image 2 — the images
   * were literally unreachable. `tabIndex={0}` on the scroller makes the arrow keys scroll
   * it natively.
   *
   * Asserted by MOVING it: reaching the element proves it is focusable, and the scroll
   * offset changing proves the arrow key did something. A test that only checked for the
   * attribute would pass on a scroller that cannot actually be driven.
   */
  test('the scroller takes focus and the arrow keys scroll it', async ({ page }) => {
    await page.goto('/products/temple-necklace-set');

    const scroller = page.locator('ul[aria-label$="images"]');
    await expect(scroller).toBeVisible();

    const imageCount = await scroller.locator('li').count();
    test.skip(imageCount < 2, 'A single-image product does not scroll');

    await scroller.focus();
    await expect(scroller).toBeFocused();

    const before = await scroller.evaluate((el) => el.scrollLeft);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    const after = await scroller.evaluate((el) => el.scrollLeft);

    expect(after, 'ArrowRight did not scroll the gallery').toBeGreaterThan(before);
  });
});
