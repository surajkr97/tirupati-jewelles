/**
 * Stage 3 E2E — the auth screens, and the redirects around them.
 *
 * Stage 2 covered where a sign-in LANDS (`navigation.spec.ts`). This covers the screens
 * themselves and the case Stage 2 left open:
 *
 *   C-4  an already-authenticated visitor was shown the sign-in form
 *   C-7  signing out gave no confirmation — a silent redirect to a homepage that looks
 *        identical either way
 *
 * plus the loop that C-4's fix creates if `?next=` is allowed to point back at an auth route.
 */
import { expect, test } from '@playwright/test';

import type { BrowserContext, Page } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

/**
 * The mobile tap-target floor, 40px — MASTER-SPEC §3 as amended by D-122.
 *
 * Was 44px, which is Apple's HIG figure and was the house rule until Stage 7. D-121 made
 * the control tokens fluid and D-122 took the mobile end to 40px; §3 and the design-system
 * spec were amended in the same pass, so this constant moves with them rather than becoming
 * the one place that still disagrees.
 *
 * WCAG 2.2 AA (SC 2.5.8) sets the real floor at 24×24px, so 40 clears the standard with
 * 16px to spare — what moved is a convention, not a requirement. `--spacing-tap` is still
 * 44px for controls that are small and isolated.
 *
 * The 0.01 slack is unchanged and is for sub-pixel layout noise, not for the rule.
 */
const TAP_MIN = 40 - 0.01;

/**
 * A customer row inserted directly, then signed in through the real endpoint.
 *
 * Same approach and reason as `claim.spec.ts` and `navigation.spec.ts`: signup is gated on an
 * email OTP observable only in the server's console (DEBT-010).
 */
async function signInAsCustomer(context: BrowserContext): Promise<void> {
  const email = `stage3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
  expect(response.ok(), 'fixture sign-in should succeed').toBe(true);
}

/** Auth routing is viewport-independent; running it three times only spends rate limit. */
function desktopOnly() {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280', 'viewport-independent');
  });
}

test.describe('C-4: a signed-in visitor is not shown the sign-in form', () => {
  desktopOnly();

  test('a customer visiting /login goes to their account', async ({ page, context }) => {
    await signInAsCustomer(context);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/account$/);
  });

  test('a customer visiting /signup goes to their account', async ({ page, context }) => {
    await signInAsCustomer(context);
    await page.goto('/signup');
    await expect(page).toHaveURL(/\/account$/);
  });

  test('a valid ?next= is honoured on the bounce', async ({ page, context }) => {
    await signInAsCustomer(context);
    await page.goto('/login?next=/rates');
    await expect(page).toHaveURL(/\/rates$/);
  });

  test('/forgot-password is NOT bounced — resetting while signed in is legitimate', async ({
    page,
    context,
  }) => {
    await signInAsCustomer(context);
    await page.goto('/forgot-password');
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('the bounce does not loop', () => {
  desktopOnly();

  test('?next=/login resolves to the role home, not back to /login', async ({
    page,
    context,
  }) => {
    await signInAsCustomer(context);
    // Without the auth-route guard in safe-next.ts this bounces forever.
    await page.goto('/login?next=/login');
    await expect(page).toHaveURL(/\/account$/);
  });

  test('a STALE session cookie falls through to the form rather than looping', async ({
    browser,
  }) => {
    /**
     * The exact failure a cookie-only proxy rule would cause: the cookie exists, so the
     * bounce fires, but the session behind it does not resolve — so /account bounces back to
     * /login and the user can never sign in. Resolving the real session here is what makes
     * this land on a usable form.
     */
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: 'tj_session',
        value: 'not-a-real-session-id',
        domain: 'localhost',
        path: '/',
      },
    ]);
    const page = await context.newPage();

    await page.goto('/login');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    await context.close();
  });
});

test.describe('an admin is bounced to the dashboard', () => {
  desktopOnly();
  test.use({ storageState: ADMIN_STATE });

  test('/login sends an admin to /admin, not /account', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe('the auth screens', () => {
  test('login has one h1, a labelled form, and a route back to the shop', async ({
    page,
  }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible();
    // Brief §13 — focused, but not a trap.
    await expect(page.getByRole('link', { name: /Back to the shop/ })).toBeVisible();

    // Real labels, not placeholder-only (brief §5).
    await expect(page.getByLabel('Mobile number or email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('an invalid sign-in shows an inline alert, not a toast', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Mobile number or email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // role="alert" — announced, and inside the form where the user is looking.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    // The generic message that keeps account existence secret (§3.6). It must NOT say
    // whether the account exists or which field was wrong.
    await expect(alert).not.toContainText(/not registered|no account|unknown user/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('signup shows where it is in the flow', async ({ page }) => {
    await page.goto('/signup');
    // Brief §6 — three screens that each look complete need a position indicator.
    await expect(page.getByText(/Step 1 of 3/)).toBeVisible();
  });

  test('the OTP boxes fit and stay tappable at 320px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280', 'viewport is driven explicitly');
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/forgot-password');

    // Reach the OTP step without sending a real code: the second step renders once the
    // request resolves, and the endpoint responds the same way for any identifier.
    const identifier = `stage3-otp-${Date.now()}@example.com`;
    await page.getByLabel('Mobile number or email').fill(identifier);
    await page.getByRole('button', { name: 'Send code' }).click();

    const boxes = page.getByRole('textbox', { name: /^Digit \d$/ });
    await expect(boxes).toHaveCount(6);

    for (const box of await boxes.all()) {
      const rect = await box.boundingBox();
      expect(rect!.height, 'OTP box height at 320px').toBeGreaterThanOrEqual(TAP_MIN);
      expect(rect!.x + rect!.width, 'OTP box stays inside 320px').toBeLessThanOrEqual(321);
    }

    // And the page itself must not scroll sideways.
    const scrolled = await page.evaluate(() => {
      window.scrollTo(9999, 0);
      const x = window.scrollX;
      window.scrollTo(0, 0);
      return x;
    });
    expect(scrolled, 'the OTP step scrolls sideways at 320px').toBe(0);
  });
});

test.describe('C-7: signing out says so', () => {
  desktopOnly();

  test('confirms, and lands on the homepage signed out', async ({ page, context }) => {
    await signInAsCustomer(context);
    await page.goto('/account');

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();

    // The confirmation the audit found missing — / looks identical either way.
    await expect(page.getByText('Signed out', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    // And the session is really gone: /account must bounce to /login.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
  });

  test('both sign-out controls meet the 44px target', async ({ page, context }) => {
    await signInAsCustomer(context);
    await page.goto('/account');

    for (const name of ['Sign out', 'Sign out of all devices']) {
      const control = page.getByRole('button', { name, exact: true });
      const rect = await control.boundingBox();
      expect(rect!.height, `${name} height`).toBeGreaterThanOrEqual(TAP_MIN);
    }
  });
});

test.describe('auth layout at the narrow widths', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280', 'viewport is driven explicitly');
  });

  for (const width of [320, 360, 390, 414] as const) {
    test(`login and signup fit at ${width}px`, async ({ page }: { page: Page }) => {
      await page.setViewportSize({ width, height: 800 });

      const submitFor: Record<string, string> = {
        '/login': 'Sign in',
        '/signup': 'Send code',
        '/forgot-password': 'Send code',
      };

      for (const route of ['/login', '/signup', '/forgot-password']) {
        await page.goto(route);
        await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' });

        const scrolled = await page.evaluate(() => {
          window.scrollTo(9999, 0);
          const x = window.scrollX;
          window.scrollTo(0, 0);
          return x;
        });
        expect(scrolled, `${route} scrolls sideways at ${width}px`).toBe(0);

        // The primary action must stay a full-width, comfortable target.
        const submit = page.getByRole('button', { name: submitFor[route]!, exact: true });
        const rect = await submit.boundingBox();
        expect(rect!.height, `${route} submit height at ${width}px`).toBeGreaterThanOrEqual(
          TAP_MIN,
        );
      }
    });
  }
});
