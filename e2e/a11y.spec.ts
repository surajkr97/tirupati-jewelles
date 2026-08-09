/**
 * Phase 9 §9.7 — `axe` clean on every route.
 *
 * ── What "clean" means here, stated rather than assumed ──
 * The bar is **WCAG 2.1 level A and AA**, which is the standard the rest of this project
 * already writes down: MASTER-SPEC §3's 4.5:1 body contrast is a WCAG AA figure, and Phase 2
 * measured its tokens against it. axe's `best-practice` tag is deliberately excluded — those
 * rules are opinions rather than the standard (they flag things like "landmark must be
 * unique"), and a suite that fails on an opinion gets its assertions loosened within a month.
 *
 * ── Why every viewport ──
 * Contrast, target size and overlap are all layout-dependent, and this project's DESIGN
 * mandate audits 375 first, then 768, then 1280. Running the audit only at 375 would test
 * the width where the design gets the most attention.
 *
 * ── What axe cannot do, and what this file therefore does NOT claim ──
 * Automated rules catch roughly a third to a half of real barriers. They cannot tell whether
 * alt text is *accurate*, whether a heading order is *meaningful*, or whether a flow is
 * usable with a screen reader. §9.7's other four items exist for that reason and are covered
 * in `e2e/keyboard.spec.ts` and `e2e/screen-reader.spec.ts`. A green run of this file is a
 * floor, not a certificate.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

/** WCAG 2.1 A + AA. See the header for why `best-practice` is not here. */
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Run axe and fail with something a person can act on.
 *
 * The default failure is a JSON dump of the whole result object, which is unreadable in CI
 * output. This reports rule, impact, the selector AND axe's own `failureSummary` — which for
 * a contrast failure carries the measured ratio and both colours. Without that a report says
 * "this fails" and leaves the reader to re-derive the number, which is the work.
 */
async function expectNoViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();

  const summary = violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 6)
        .map((node) => {
          const why = (node.failureSummary ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('Fix'))
            .join(' ');
          return `        ${node.target.join(' ')}\n          ${why}`;
        })
        .join('\n');
      const more =
        violation.nodes.length > 6
          ? `\n        …and ${violation.nodes.length - 6} more`
          : '';
      return `  [${violation.impact}] ${violation.id} — ${violation.help}\n    ${violation.helpUrl}\n${nodes}${more}`;
    })
    .join('\n');

  expect(
    violations.map((violation) => violation.id),
    `${label}\n${summary}`,
  ).toEqual([]);
}

/**
 * Every route reachable without a session.
 *
 * Slugs are real seeded ones rather than invented: a 404 renders a different page, and a
 * clean audit of a 404 would prove nothing about the page it was meant to check. `/search`
 * carries a query for the same reason — the empty state and the results list are different
 * markup, and the results list is the one with the interesting semantics.
 */
const PUBLIC_ROUTES = [
  '/',
  '/rates',
  '/collections',
  '/collections/rings',
  '/products/temple-necklace-set',
  '/products/classic-solitaire-ring',
  '/calculator',
  '/search?q=gold',
  '/policies/buyback',
  '/policies/exchange',
  '/login',
  '/signup',
  '/forgot-password',
];

test.describe('§9.7 — axe on the public routes', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(route);
      await expectNoViolations(page, `axe violations on ${route}`);
    });
  }
});

/**
 * The states axe never sees on a plain page load.
 *
 * A modal, an expanded disclosure and a populated list are where accessibility defects
 * actually live — an empty calculator has no item cards to get wrong, and a closed sheet has
 * no focus trap to audit. §9.7 says "every route"; a route in one state is not the route.
 */
test.describe('§9.7 — axe on the interactive states', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the calculator with items, and a breakdown expanded', async ({ page }) => {
    await page.goto('/calculator');

    await page.getByLabel('Weight').fill('8.5');
    await page.getByRole('button', { name: /Add another item/i }).click();
    await expect(page.getByTestId('item-card')).toHaveCount(2);

    await page
      .getByRole('button', { name: /Show breakdown/i })
      .first()
      .click();

    await expectNoViolations(page, 'axe violations on /calculator with items');
  });

  test('the catalogue filter sheet, open', async ({ page }) => {
    await page.goto('/collections/rings');
    await page.getByTestId('open-filters').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await expectNoViolations(page, 'axe violations on the open filter sheet');
  });

  test('a product page with the enquiry bar and gallery', async ({ page }) => {
    await page.goto('/products/classic-solitaire-ring');
    await expect(page.getByRole('link', { name: /enquire on whatsapp/i })).toBeVisible();

    await expectNoViolations(page, 'axe violations on a product page, fully rendered');
  });
});

/**
 * A signed-in customer's own screens.
 *
 * The account row is inserted and the LOGIN goes through the real endpoint — the same shape
 * `claim.spec.ts` uses and for the same reason: signup is gated on an email OTP that is only
 * observable in server console output (DEBT-010), so driving the form would be testing a log
 * format rather than an account page.
 */
async function signInCustomer(context: BrowserContext, email: string): Promise<void> {
  const password = 'a-strong-enough-passphrase-42';

  const { PrismaClient } = await import('@prisma/client');
  const { hash } = await import('@node-rs/argon2');
  const db = new PrismaClient();

  try {
    await db.user.create({
      data: {
        email,
        passwordHash: await hash(password, {
          algorithm: 2,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        emailVerified: true,
      },
    });
  } finally {
    await db.$disconnect();
  }

  const response = await context.request.post('/api/auth/login', {
    data: { identifier: email, password },
  });
  expect(response.ok(), `customer sign-in failed: ${response.status()}`).toBe(true);
}

test.describe('§9.7 — axe on a customer account', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/account/orders', async ({ page, context }, testInfo) => {
    await signInCustomer(
      context,
      `a11y-${testInfo.project.name}-${Date.now()}@example.com`,
    );

    await page.goto('/account/orders');
    await expectNoViolations(page, 'axe violations on /account/orders');
  });
});

/**
 * The admin panel.
 *
 * §7.1 makes every one of these 404 without a session, so they need the shared cookie jar.
 * They are included because "every route" means every route: the owner uses this panel daily
 * and is as entitled to an accessible one as a customer is.
 */
const ADMIN_ROUTES = [
  '/admin',
  '/admin/rates',
  '/admin/products',
  '/admin/products/new',
  '/admin/categories',
  '/admin/media',
  '/admin/settings',
  '/admin/audit',
  '/admin/bills',
  '/admin/bills/new',
];

test.describe('§9.7 — axe on the admin panel', () => {
  test.use({ storageState: ADMIN_STATE });

  for (const route of ADMIN_ROUTES) {
    test(`${route} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(route);
      await expectNoViolations(page, `axe violations on ${route}`);
    });
  }

  test('the product editor, which is the longest form in the application', async ({
    page,
  }) => {
    await page.goto('/admin/products');
    // The whole row is the link; there is no separate "Edit" control to name.
    await page.locator('a[href^="/admin/products/"]').first().click();
    await expect(page).toHaveURL(/\/admin\/products\/[^/]+$/);

    await expectNoViolations(page, 'axe violations on the product editor');
  });
});

/**
 * WCAG 2.1 §1.4.10 Reflow, on screens whose content grows with the business.
 *
 * DEBT-038's closure left this to §9.7 explicitly: the admin dashboard was found overflowing
 * at 375px once the shop's totals passed ₹1 crore, and the note observed that its sibling
 * screens had only been PROBED against today's data rather than given the same worst-case
 * treatment. A probe expires the moment the database grows.
 *
 * Reflow is the criterion this actually falls under — content must not require horizontal
 * scrolling at 320 CSS px — and it is the one axe cannot check, because it depends on data
 * the page does not have yet. So the figures are substituted rather than waited for.
 */
test.describe('§9.7 — no screen scrolls sideways at ₹1000 crore', () => {
  test.use({ storageState: ADMIN_STATE });

  /** More than this shop will ever total: all digits, all separators, longest form. */
  const WORST_CASE = '₹9,99,99,99,999';

  async function inflateMoneyAndMeasure(page: Page) {
    return page.evaluate((worstCase) => {
      // Every element whose entire text is a rupee figure — the money the shop earns is the
      // only text on these screens that grows without bound.
      const money = [...document.querySelectorAll('p, span, dd, td, div')].filter(
        (el) => {
          const own = [...el.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? '')
            .join('')
            .trim();
          return /^₹[\d,]+(\.\d+)?$/.test(own);
        },
      );

      for (const el of money) {
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && /₹/.test(node.textContent ?? '')) {
            node.textContent = worstCase;
          }
        }
      }

      return {
        substituted: money.length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    }, WORST_CASE);
  }

  for (const route of ['/admin', '/admin/bills', '/admin/products']) {
    test(`${route} holds a crore-scale figure`, async ({ page }, testInfo) => {
      test.skip(
        testInfo.project.name !== 'mobile-375',
        'The narrow viewport is the test',
      );
      await page.goto(route);

      const result = await inflateMoneyAndMeasure(page);
      expect(
        result.substituted,
        `${route}: no money figure found to inflate`,
      ).toBeGreaterThan(0);
      expect(
        result.scrollWidth,
        `${route}: ${result.scrollWidth}px of content in a ${result.clientWidth}px viewport`,
      ).toBeLessThanOrEqual(result.clientWidth);
    });
  }
});
