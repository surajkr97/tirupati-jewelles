/**
 * Stage 5A — the admin shell, its navigation, and the boundary around it.
 *
 * Two halves, and the second is the one that matters:
 *
 *   1. Every real admin destination is reachable on both desktop and phone, and the way back
 *      to the shop is always there.
 *   2. None of that navigation is load-bearing for SECURITY. §4: hiding a link is not an
 *      authorisation, so the tests below check a customer is rejected by the server whether
 *      or not a link was ever rendered for them.
 */
import { expect, test } from '@playwright/test';

import type { BrowserContext } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

/**
 * Still 44px, deliberately, while `e2e/auth.spec.ts` moved to 40 (D-122).
 *
 * Not an inconsistency. D-122 lowered `--spacing-control`, the height of full-width form
 * controls, and explicitly did NOT move `--spacing-tap` — the floor a small, isolated
 * control reaches for. Everything this spec measures is admin navigation chrome built on
 * `h-tap` / `min-h-tap`, so 44 is the number it should still be held to, and this assertion
 * is what stops that floor being quietly lowered later.
 */
const TAP_MIN = 44 - 0.01;

/** Every top-level admin destination, from `lib/navigation.ts`. */
const ADMIN_ROUTES = [
  '/admin',
  '/admin/rates',
  '/admin/products',
  '/admin/bills',
  '/admin/categories',
  '/admin/media',
  '/admin/settings',
  '/admin/audit',
] as const;

/** A signed-in CUSTOMER — the role the admin area must reject. */
async function signInAsCustomer(context: BrowserContext): Promise<void> {
  const email = `stage5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

  const res = await context.request.post('/api/auth/login', {
    data: { identifier: email, password },
  });
  expect(res.ok(), 'fixture sign-in should succeed').toBe(true);
}

test.describe('the desktop rail', () => {
  test.use({ storageState: ADMIN_STATE });

  test('exposes every admin destination and the way out', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-375', 'the rail is md: and up');

    await page.goto('/admin');
    const rail = page.getByRole('navigation', { name: 'Admin' });
    await expect(rail).toBeVisible();

    const hrefs = await rail
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((a) => (a as HTMLAnchorElement).getAttribute('href')),
      );

    for (const route of ADMIN_ROUTES) {
      expect(hrefs, `${route} must be in the rail`).toContain(route);
    }
    // §9 — the exit is always present.
    expect(hrefs, 'the rail must offer a way back to the shop').toContain('/');
  });

  test('every rail destination actually resolves', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-375', 'the rail is md: and up');

    await page.goto('/admin');
    const hrefs = await page
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((a) => (a as HTMLAnchorElement).getAttribute('href')),
      );

    for (const href of hrefs) {
      const response = await page.request.get(href!);
      expect(response.status(), `${href} should resolve`).toBe(200);
    }
  });

  test('"Back to shop" leaves the admin', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-375', 'the rail is md: and up');

    await page.goto('/admin/settings');
    await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Back to shop' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('the mobile menu', () => {
  test.use({ storageState: ADMIN_STATE });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'phone layout');
  });

  test('the drawer lists EVERY destination, not only the overflow', async ({ page }) => {
    await page.goto('/admin');

    const trigger = page.getByRole('button', { name: 'All admin pages' });
    await expect(trigger).toBeVisible();

    const box = await trigger.boundingBox();
    expect(box!.height, 'menu trigger tap target').toBeGreaterThanOrEqual(TAP_MIN);

    await trigger.click();
    const menu = page.getByRole('navigation', { name: 'All admin pages' });
    await expect(menu).toBeVisible();

    const hrefs = await menu
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((a) => (a as HTMLAnchorElement).getAttribute('href')),
      );

    // Stage 5 §11: the phone's menu must expose all of them, plus the exit.
    for (const route of ADMIN_ROUTES) {
      expect(hrefs, `${route} must be in the mobile menu`).toContain(route);
    }
    expect(hrefs).toContain('/');
  });

  test('every target in the bottom bar meets 44px', async ({ page }) => {
    await page.goto('/admin');
    const nav = page.getByRole('navigation', { name: 'Admin' });

    const targets = [
      ...(await nav.getByRole('link').all()),
      ...(await nav.getByRole('button').all()),
    ];
    expect(targets).toHaveLength(5);

    for (const target of targets) {
      const box = await target.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(TAP_MIN);
    }
  });

  test('the admin fits at 320px without scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });

    for (const route of ADMIN_ROUTES) {
      await page.goto(route);
      const scrolled = await page.evaluate(() => {
        window.scrollTo(9999, 0);
        const x = window.scrollX;
        window.scrollTo(0, 0);
        return x;
      });
      expect(scrolled, `${route} scrolls sideways at 320px`).toBe(0);
    }
  });
});

test.describe('Bills & orders is labelled truthfully', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the nav says "Bills & orders" and points at /admin/bills', async ({
    page,
  }, testInfo) => {
    await page.goto('/admin');

    if (testInfo.project.name === 'mobile-375') {
      /**
       * The bottom bar abbreviates to "Bills" — a ~57px cell at 320px cannot hold the full
       * label without dropping its second line out of the row (measured). The full label is
       * in the drawer, which is where someone goes looking.
       */
      const bar = page.getByRole('navigation', { name: 'Admin' });
      await expect(bar.getByRole('link', { name: 'Bills' })).toHaveAttribute(
        'href',
        '/admin/bills',
      );

      await page.getByRole('button', { name: 'All admin pages' }).click();
      const menu = page.getByRole('navigation', { name: 'All admin pages' });
      await expect(menu.getByRole('link', { name: /Bills & orders/ })).toHaveAttribute(
        'href',
        '/admin/bills',
      );
      return;
    }

    const link = page.getByRole('link', { name: /Bills & orders/ }).first();
    await expect(link).toHaveAttribute('href', '/admin/bills');
  });

  test('there is no /admin/orders link anywhere in the admin', async ({ page }) => {
    // DEBT-004: an Order is written by the bill builder, so the bill IS the order. A link
    // to a route that does not exist is the defect the navigation registry exists to stop.
    await page.goto('/admin');
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((links) =>
        links.map((a) => (a as HTMLAnchorElement).getAttribute('href')),
      );
    expect(hrefs).not.toContain('/admin/orders');
  });
});

/**
 * §4 — the UI is not the authorisation boundary.
 *
 * Every assertion here is about the SERVER's answer, not about whether a link was rendered.
 */
test.describe('the admin boundary holds without any help from the navigation', () => {
  test('a signed-in CUSTOMER is refused every admin route', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280', 'server behaviour, not layout');

    await signInAsCustomer(context);

    for (const route of ADMIN_ROUTES) {
      const response = await page.request.get(route);
      // §3.6: 404, never 403 — a 403 confirms the route exists just as loudly.
      expect(response.status(), `${route} must 404 for a customer`).toBe(404);
    }
  });

  test('a customer sees no admin navigation on the storefront', async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280', 'server behaviour, not layout');

    await signInAsCustomer(context);
    await page.goto('/account');

    await expect(page.getByRole('link', { name: /Admin dashboard/i })).toHaveCount(0);
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((l) => l.map((a) => (a as HTMLAnchorElement).getAttribute('href')));
    expect(hrefs.filter((h) => h?.startsWith('/admin'))).toHaveLength(0);
  });

  test('a signed-out visitor is refused too', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    const response = await page.request.get('/admin');
    expect(response.status()).toBe(404);

    await context.close();
  });
});

test.describe('an admin can find the admin from the storefront', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the account page links to the dashboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280', 'not a layout concern');

    // C-3: an admin used to land here with an "Admin" badge and no way onward.
    await page.goto('/account');
    const link = page.getByRole('link', { name: /Open the dashboard/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/admin');
  });
});
