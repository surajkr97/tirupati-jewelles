/**
 * Phase 9 E2E — the flagship journey, end to end, in a real browser (DEBT-011).
 * specs/08-billing-whatsapp.md, acceptance criterion 4:
 *
 *   "Unclaimed orders attach on verified phone signup."
 *   TEST: "Bill for a phone with no account → userId null → user signs up and verifies that
 *          phone → order appears. **The flagship end-to-end test.**"
 *
 * Phase 8 could prove every step of this except the middle one, because nothing in the
 * running application could prove possession of a phone number. This is that test finally
 * being possible: a shop assistant bills a walk-in, the customer opens the link that was
 * sent to their number, and the purchase is in their account.
 *
 * The claim link is pulled out of the `wa.me` href on the admin screen — the same string the
 * customer would receive — rather than minted by the test. Reaching into the database for a
 * token would prove the claim works and skip the question of whether the message carries it.
 */
import { expect, test, type BrowserContext } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

const MOBILE = 'mobile-375';

/** A number nobody in the seed owns, unique per run so repeated runs do not collide. */
function freshPhone(): string {
  // 9 + 9 digits, inside the assigned Indian mobile range.
  return `9${String(Date.now()).slice(-9)}`;
}

/**
 * Create a customer account and sign it in.
 *
 * ── Why the account is created directly rather than through /signup ──
 * Signup is a three-step flow gated on an email OTP, and the code is only observable in the
 * server's console output — there is no mail catcher in this harness. Phase 3 hit the same
 * wall and recorded it as DEBT-010. Driving the form here would mean scraping a log file,
 * which is a test of the log format rather than of the claim.
 *
 * So the row is inserted and the LOGIN goes through the real endpoint, which is the part
 * that matters for this spec: the session it produces is a genuine one. What is being tested
 * is what happens after a customer has an account, not how they got it.
 *
 * `@prisma/client` and `@node-rs/argon2` are imported directly, the way `admin.setup.ts`
 * imports `ioredis` — Playwright does not resolve the `@/` alias.
 */
async function createSignedInCustomer(
  context: BrowserContext,
  email: string,
): Promise<void> {
  const password = 'a-strong-enough-passphrase-42';

  const { PrismaClient } = await import('@prisma/client');
  const { hash } = await import('@node-rs/argon2');
  const db = new PrismaClient();

  try {
    await db.user.create({
      data: {
        email,
        // The same OWASP parameters lib/auth/argon2.ts uses; a weaker hash here would be
        // rejected by the verifier.
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

/**
 * Clear this machine's claim counters before the journey runs.
 *
 * The claim limiter allows 10 attempts per IP per hour and fails closed. Every run of this
 * spec spends two — one real claim and one deliberate re-use — so five runs in an hour lock
 * the suite out, and it surfaced as the success message never appearing, which reads like a
 * broken claim rather than a full bucket.
 *
 * Exactly the situation `admin.setup.ts` documents for logins, handled the same way and with
 * the same scope: loopback keys only. The limiter itself is asserted in
 * `app/api/auth/claim/route.test.ts`, where the counter is controlled.
 */
async function resetClaimLimiter(): Promise<void> {
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL!, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();
    const keys = await redis.keys('rl:claim:*');
    const mine = keys.filter((key) => key.includes('::1') || key.includes('127.0.0.1'));
    if (mine.length > 0) await redis.del(...mine);
  } catch {
    // No Redis reachable — the claim below will report the real problem.
  } finally {
    redis.disconnect();
  }
}

test.describe('the flagship journey — bill a walk-in, they claim it', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(resetClaimLimiter);

  test('an in-shop purchase reaches the customer’s account', async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== MOBILE,
      'Creates orders and consumes bill numbers',
    );

    const phone = freshPhone();

    // ── 1. The shop raises a bill for someone with no account ──────────────

    const adminContext = await browser.newContext({ storageState: ADMIN_STATE });
    const admin = await adminContext.newPage();

    await admin.goto('/admin/bills/new');
    await admin.getByLabel('Name', { exact: true }).fill('Walk-in Customer');
    await admin.getByLabel('Mobile number').fill(phone);
    await admin.getByLabel('Weight').nth(0).fill('12.500');
    await admin.getByLabel('Making').nth(0).fill('12');

    const total = admin.getByTestId('bill-total');
    await expect(total).not.toHaveText('—', { timeout: 10_000 });

    await admin.getByRole('button', { name: 'Generate' }).click();
    await admin.waitForURL(/\/admin\/bills\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const orderNo = await admin.getByRole('heading', { level: 1 }).innerText();

    // Nobody owns it yet — the state the whole feature exists to resolve.
    await expect(admin.getByText('Unclaimed')).toBeVisible();

    // ── 2. The claim link is in the message that goes to that number ───────

    const waHref = await admin
      .getByRole('link', { name: /Send on WhatsApp/ })
      .getAttribute('href');
    const message = new URL(waHref!).searchParams.get('text')!;

    const claimUrl = message.match(/https?:\/\/\S+\/claim\/[A-Za-z0-9_-]+/)?.[0];
    expect(claimUrl, 'the WhatsApp message must carry a claim link').toBeTruthy();

    const claimPath = new URL(claimUrl!).pathname;

    // ── 3. A stranger cannot use it ────────────────────────────────────────

    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(claimPath);
    // Signed out: sent to log in, and the token is NOT consumed on the way.
    await expect(strangerPage).toHaveURL(/\/login\?next=/);
    await stranger.close();

    // ── 4. The customer signs up afterwards, by email, with no phone ───────

    const customer = await browser.newContext();
    const page = await customer.newPage();

    const email = `claim-${Date.now()}@example.com`;
    await createSignedInCustomer(customer, email);

    // Their history is empty — §8.6's discovery state.
    await page.goto('/account/orders');
    await expect(page.getByText('No purchases yet')).toBeVisible();

    // ── 5. They open the link from WhatsApp and confirm ────────────────────

    await page.goto(claimPath);

    // The page must NOT have claimed anything just by being opened.
    await expect(page.getByRole('button', { name: /these are mine/i })).toBeVisible();
    // It names the number without disclosing it in full.
    await expect(page.getByText(new RegExp(phone.slice(-5)))).toBeVisible();

    await page.getByRole('button', { name: /these are mine/i }).click();
    await expect(page.getByText(/purchase added|purchases added/)).toBeVisible({
      timeout: 15_000,
    });

    // ── 6. The purchase is in their account ────────────────────────────────

    await page.goto('/account/orders');
    await expect(page.getByText(orderNo)).toBeVisible();
    // And the prompt to add a number is gone, because the number is now proven.
    await expect(page.getByText('Bought from us before?')).toHaveCount(0);

    // ── 7. The link is spent ───────────────────────────────────────────────

    await page.goto(claimPath);

    /**
     * The customer who just claimed sees "You're all set", not "this link is dead".
     *
     * Both are true; only one is useful. Re-opening the WhatsApp message is the commonest
     * thing they will do next, and the dead-link copy at that moment reads as though the
     * claim failed. The dead-link page is what a visitor WITHOUT a verified number sees —
     * asserted in the SECURITY block below.
     */
    await expect(page.getByText(/You’re all set|You're all set/)).toBeVisible();

    // And re-opening it claimed nothing a second time.
    await expect(page.getByRole('button', { name: /these are mine/i })).toHaveCount(0);

    // ── 8. The shop sees it as claimed ─────────────────────────────────────

    await admin.reload();
    await expect(admin.getByText('Claimed')).toBeVisible();

    await customer.close();
    await adminContext.close();
  });
});

test.describe('SECURITY — the claim boundary', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a guessed token is refused and reveals nothing', async ({ page }) => {
    await page.goto(`/claim/${'A'.repeat(43)}`);
    // Same message as an expired or already-used link — no oracle.
    await expect(page.getByText('This link is no longer valid')).toBeVisible();
  });

  test('the claim page is noindex — the URL is a credential', async ({ page }) => {
    await page.goto(`/claim/${'A'.repeat(43)}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
  });

  test('the API refuses a signed-out caller', async ({ request }) => {
    const response = await request.post('/api/auth/claim', {
      data: { token: 'A'.repeat(43) },
    });
    expect(response.status()).toBe(401);
  });

  test('the API refuses a cross-origin post', async ({ request }) => {
    const response = await request.post('/api/auth/claim', {
      headers: { origin: 'https://evil.example' },
      data: { token: 'A'.repeat(43) },
    });
    expect(response.status()).toBe(403);
  });
});
