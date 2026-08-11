/**
 * Stage 2 E2E — the shell, wayfinding, and the route states.
 *
 * One test per confirmed audit finding, so a regression names the defect it brought back:
 *
 *   C-1  no desktop navigation — the header held a wordmark and two icons, and BottomNav is
 *        md:hidden, so at ≥768px there was no route to Rates/Calculator/Collections at all
 *   C-2  no loading.tsx / error.tsx / not-found.tsx anywhere in app/
 *   C-3  an admin signing in landed on /account with no link onward
 *   C-5  /admin/settings and /admin/audit were absent from the admin navigation
 *   C-6  no route back to the storefront from /admin
 */
import { expect, test } from '@playwright/test';

import type { BrowserContext } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

const TAP_MIN = 44 - 0.01;

/**
 * A customer row, inserted directly.
 *
 * The same approach and the same reason as `claim.spec.ts`: signup is gated on an email OTP
 * that is only observable in the server's console (DEBT-010), so driving the form would test
 * the log format. The LOGIN below goes through the real endpoint and the real form, which is
 * the part this spec is actually about.
 */
async function createCustomer(context: BrowserContext): Promise<{
  email: string;
  password: string;
}> {
  const email = `stage2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'a-strong-enough-passphrase-42';

  const { PrismaClient } = await import('@prisma/client');
  const { hash } = await import('@node-rs/argon2');
  const db = new PrismaClient();

  try {
    await db.user.create({
      data: {
        email,
        // The OWASP parameters lib/auth/argon2.ts uses; a weaker hash would be rejected.
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

  void context;
  return { email, password };
}

async function signInThroughTheForm(
  page: import('@playwright/test').Page,
  identifier: string,
  password: string,
  next?: string,
): Promise<void> {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByLabel('Mobile number or email').fill(identifier);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * ── Where a sign-in lands ──
 *
 * Desktop only, and deliberately: the destination is pure routing and does not vary with
 * viewport, so running these three times would add no information and would spend three
 * times the logins against a limiter that allows 30 per IP per 15 minutes
 * (`LOGIN_LIMITS.perIp`). `lib/auth/safe-next.test.ts` covers the decision exhaustively;
 * this covers the wiring.
 */
test.describe('sign-in destination', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-1280',
      'viewport-independent — see the comment above',
    );
  });

  test('C-3: an admin lands on /admin, not /account', async ({ page }) => {
    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;
    expect(email, 'SEED_ADMIN_EMAIL must be set').toBeTruthy();
    expect(password, 'SEED_ADMIN_PASSWORD must be set').toBeTruthy();

    await signInThroughTheForm(page, email!, password!);

    // The defect: this used to be /account, with an "Admin" badge and no link onward.
    await expect(page).toHaveURL(/\/admin$/);
    // 'Shop admin' is a <p> in the admin shell, not a heading — locate it as text.
    await expect(page.getByText('Shop admin')).toBeVisible();
  });

  test('a customer lands on /account', async ({ page, context }) => {
    const { email, password } = await createCustomer(context);
    await signInThroughTheForm(page, email, password);
    await expect(page).toHaveURL(/\/account$/);
  });

  test('a valid ?next= wins over the role default', async ({ page, context }) => {
    const { email, password } = await createCustomer(context);
    await signInThroughTheForm(page, email, password, '/rates');
    await expect(page).toHaveURL(/\/rates$/);
  });

  test('an open-redirect ?next= is refused, not followed', async ({ page, context }) => {
    const { email, password } = await createCustomer(context);
    // The backslash form — accepted by the old inline check, UI_REDESIGN_DEBT-002.
    await signInThroughTheForm(page, email, password, '/\\evil.example');

    await expect(page).toHaveURL(/\/account$/);
    expect(page.url()).not.toContain('evil.example');
  });
});

/**
 * ── C-1: the desktop header ──
 */
test.describe('storefront navigation', () => {
  test('C-1: at ≥768px the header exposes the primary routes', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-375',
      'the desktop nav is md: and up by design; the phone has the bottom nav',
    );

    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });

    for (const [label, href] of [
      ['Rates', '/rates'],
      ['Calculator', '/calculator'],
      ['Collections', '/collections'],
    ] as const) {
      const link = nav.getByRole('link', { name: label, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', href);
    }
  });

  test('C-1: those links actually navigate', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-375', 'desktop nav');

    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Rates', exact: true })
      .click();
    await expect(page).toHaveURL(/\/rates$/);
    // Proves the destination rendered rather than 404'ing.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the mobile menu opens, is labelled, and navigates', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'the menu button is md:hidden');

    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Open menu' });
    await expect(trigger).toBeVisible();

    const box = await trigger.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(TAP_MIN);
    expect(box!.height).toBeGreaterThanOrEqual(TAP_MIN);

    await trigger.click();
    const menu = page.getByRole('navigation', { name: 'All pages' });
    await expect(menu).toBeVisible();

    await menu.getByRole('link', { name: 'Calculator', exact: true }).click();
    await expect(page).toHaveURL(/\/calculator$/);
    // The sheet must not survive the navigation.
    await expect(menu).toBeHidden();
  });

  test('Esc closes the mobile menu', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'mobile only');

    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('navigation', { name: 'All pages' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'All pages' })).toBeHidden();
  });
});

/**
 * ── C-5 and C-6: the admin shell ──
 */
test.describe('admin navigation', () => {
  test.use({ storageState: ADMIN_STATE });

  test('C-5: settings and audit are reachable from the navigation', async ({
    page,
  }, testInfo) => {
    await page.goto('/admin');

    if (testInfo.project.name === 'mobile-375') {
      // On a phone they live behind "More", which is a real menu rather than the old
      // direct link to /admin/media that was labelled "More" and went somewhere else.
      await page.getByRole('button', { name: 'More admin pages' }).click();
      const sheet = page.getByRole('navigation', { name: 'Secondary admin pages' });
      await expect(sheet.getByRole('link', { name: /Settings/ })).toBeVisible();
      await expect(sheet.getByRole('link', { name: /Audit log/ })).toBeVisible();
      await sheet.getByRole('link', { name: /Settings/ }).click();
    } else {
      const rail = page.getByRole('navigation', { name: 'Admin' });
      await expect(rail.getByRole('link', { name: /Settings/ })).toBeVisible();
      await expect(rail.getByRole('link', { name: /Audit log/ })).toBeVisible();
      await rail.getByRole('link', { name: /Settings/ }).click();
    }

    await expect(page).toHaveURL(/\/admin\/settings$/);
  });

  test('C-6: there is a route back to the storefront', async ({ page }, testInfo) => {
    await page.goto('/admin');

    if (testInfo.project.name === 'mobile-375') {
      await page.getByRole('button', { name: 'More admin pages' }).click();
    }

    await page.getByRole('link', { name: 'Back to site' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('every admin destination resolves — no dead links in the rail', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-375', 'the rail is md: and up');

    await page.goto('/admin');
    const rail = page.getByRole('navigation', { name: 'Admin' });
    const hrefs = await rail.getByRole('link').evaluateAll((links) =>
      links.map((a) => (a as HTMLAnchorElement).getAttribute('href')),
    );

    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      expect(href).toBeTruthy();
      expect(href).not.toBe('#');
      const response = await page.request.get(href!);
      // 200, never a 404 — the footer shipped two links to a 404 for three phases.
      expect(response.status(), `${href} should resolve`).toBe(200);
    }
  });

  test('the desktop rail does not overlap the content column', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-375', 'no rail on a phone');

    await page.goto('/admin');
    const rail = page.getByRole('navigation', { name: 'Admin' });
    const heading = page.getByText('Shop admin');

    const railBox = await rail.boundingBox();
    const headingBox = await heading.boundingBox();
    // The content column reserves the rail's width from the same token. If that drifts,
    // the header text slides under a fixed nav and this catches it.
    expect(headingBox!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width);
  });
});

/**
 * ── C-2: the route states ──
 */
test.describe('route states', () => {
  test('the 404 is branded and offers real recovery actions', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response!.status()).toBe(404);

    // A heading, not Next's default page — and an h1, so "navigate by headings" lands.
    await expect(
      page.getByRole('heading', { level: 1, name: /couldn't find that page/i }),
    ).toBeVisible();

    for (const [label, href] of [
      [/Back to home/, '/'],
      [/Browse the collection/, '/collections'],
      // The page renders `&rsquo;` — a regex avoids asserting on which apostrophe won.
      [/Today.s rates/, '/rates'],
    ] as const) {
      const link = page.getByRole('link', { name: label });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', href);
    }
  });

  test('the 404 recovery action actually works', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await page.getByRole('link', { name: 'Browse the collection' }).click();
    await expect(page).toHaveURL(/\/collections$/);
  });

  test('a signed-out visitor probing /admin gets the storefront 404, not an admin one', async ({
    browser,
  }) => {
    // §3.6: "return 404, not 403 — do not confirm the route exists." An admin-branded 404
    // with a "Back to dashboard" button would confirm it just as loudly, which is why there
    // is deliberately no app/admin/not-found.tsx.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    const response = await page.goto('/admin');
    expect(response!.status()).toBe(404);
    await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
    await expect(page.getByText(/dashboard/i)).toHaveCount(0);

    await context.close();
  });
});
