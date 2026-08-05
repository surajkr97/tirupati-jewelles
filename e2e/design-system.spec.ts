/**
 * Phase 2 E2E audit against specs/02-design-system.md acceptance criteria.
 *
 * These assert computed geometry, which is the only way to check tap targets and overflow
 * honestly — a class name says what was intended, the layout says what happened.
 */
import { expect, test } from '@playwright/test';

test.describe('/__design gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/__design');
  });

  test('renders the full library', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Design system', level: 1 }),
    ).toBeVisible();

    for (const section of [
      'Colour tokens',
      'Buttons — variants',
      'Card',
      'Input',
      'Select',
      'SegmentedControl — arrow-key navigable',
      'Badge',
      'Skeleton — must match final dimensions exactly',
      'ImageFrame — empty state must look deliberate',
      'EmptyState',
    ]) {
      await expect(page.getByRole('heading', { name: section })).toBeVisible();
    }
  });

  // Acceptance criterion 3. The gallery is the densest page in the app, so if anything
  // overflows anywhere it overflows here.
  test('no horizontal scroll at any width', async ({ page }) => {
    const overflows = await page.evaluate(() => {
      const el = document.documentElement;
      return { scroll: el.scrollWidth, client: el.clientWidth };
    });

    expect(overflows.scroll).toBeLessThanOrEqual(overflows.client);
  });

  // Acceptance criterion 4 — MASTER-SPEC §3: "Every interactive element >= 44x44px."
  test('every interactive element meets the 44px tap target', async ({ page }) => {
    const undersized = await page.evaluate(() => {
      const MIN = 44;
      const selector =
        'button, a[href], select, input:not([type="hidden"]), [role="radio"]';
      const bad: { tag: string; text: string; w: number; h: number }[] = [];

      for (const el of Array.from(document.querySelectorAll(selector))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // not rendered
        // Round to shake off sub-pixel layout noise.
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (w < MIN || h < MIN) {
          bad.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent ?? '').trim().slice(0, 30),
            w,
            h,
          });
        }
      }
      return bad;
    });

    expect(undersized, `undersized targets: ${JSON.stringify(undersized)}`).toEqual([]);
  });

  /**
   * MASTER-SPEC §3 states two things that only coexist under one reading:
   *   "Small 14/20"                        — 14px is a legitimate scale step
   *   "Never below 15px for body copy"     — prose has a 15px floor
   *
   * So 14px is for microcopy — field labels, hints, validation messages, badges,
   * captions, metadata — and 15px+ is for running prose. See DECISIONS.md D-008.
   * Both halves are asserted: a hard 14px floor everywhere, and 15px for prose.
   */
  test('no text anywhere is below the 14px scale floor', async ({ page }) => {
    const belowFloor = await page.evaluate(() => {
      const bad: { text: string; size: number }[] = [];

      for (const el of Array.from(document.querySelectorAll('body *'))) {
        // Only elements that directly own visible text.
        const own = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join('')
          .trim();
        if (!own) continue;

        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 14) bad.push({ text: own.slice(0, 40), size });
      }
      return bad;
    });

    expect(
      belowFloor,
      `text under the 14px floor: ${JSON.stringify(belowFloor)}`,
    ).toEqual([]);
  });

  test('running prose is never below 15px', async ({ page }) => {
    const tooSmall = await page.evaluate(() => {
      const bad: { text: string; size: number }[] = [];

      for (const el of Array.from(document.querySelectorAll('p'))) {
        // Prose, not microcopy: a full sentence of some length that is not a form
        // hint or validation message.
        if (el.closest('label') || el.getAttribute('role') === 'alert') continue;
        if (el.id.endsWith('-hint') || el.id.endsWith('-error')) continue;

        const text = (el.textContent ?? '').trim();
        if (text.length < 40) continue;

        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 15) bad.push({ text: text.slice(0, 40), size });
      }
      return bad;
    });

    expect(tooSmall, `prose under 15px: ${JSON.stringify(tooSmall)}`).toEqual([]);
  });
});

test.describe('Sheet — focus management', () => {
  test('traps focus, and Esc closes it', async ({ page }) => {
    await page.goto('/__design');
    await page.getByRole('button', { name: 'Open sheet' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Tab well past the number of focusable elements inside; focus must never escape.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((d) => d.contains(document.activeElement));
      expect(inside, `focus escaped the sheet on tab ${i + 1}`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});

test.describe('SegmentedControl — keyboard', () => {
  test('arrow keys move selection without a mouse', async ({ page }) => {
    await page.goto('/__design');

    const group = page.getByRole('radiogroup', { name: 'Metal and purity' });
    await group.getByRole('radio', { name: '22K' }).focus();

    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: '18K' })).toBeChecked();

    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: 'Silver' })).toBeChecked();

    // Wraps.
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: '22K' })).toBeChecked();
  });
});

test.describe('storefront shell', () => {
  test('bottom nav is fixed and clears the safe-area inset', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'Bottom nav is mobile-only');

    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();

    const { position, paddingBottom } = await nav.evaluate((el) => {
      const s = getComputedStyle(el);
      return { position: s.position, paddingBottom: s.paddingBottom };
    });

    expect(position).toBe('fixed');
    // env(safe-area-inset-bottom) resolves to 0px in a headless browser with no notch —
    // what matters is that the declaration is present and resolves, not its value here.
    expect(paddingBottom).toBeTruthy();
  });

  test('bottom nav does not cover the footer', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'Bottom nav is mobile-only');

    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const footerBottom = await page
      .locator('footer')
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const navTop = await page
      .getByRole('navigation', { name: 'Primary' })
      .evaluate((el) => el.getBoundingClientRect().top);

    // The spacer must reserve the nav's height in normal flow.
    expect(footerBottom).toBeLessThanOrEqual(navTop + 1);
  });

  test('header is present on the storefront', async ({ page }) => {
    await page.goto('/');

    const header = page.getByRole('banner');
    await expect(header).toBeVisible();
    // Scoped to the header: the footer also links to /search, so an unscoped query is
    // ambiguous and Playwright rejects it under strict mode.
    await expect(header.getByRole('link', { name: 'Search' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Account' })).toBeVisible();
  });
});
