/**
 * One admin sign-in, shared by the whole admin suite.
 * Created by Phase 7 (specs/07-admin-panel.md).
 *
 * Signing in per test hit the Phase 3 login rate limiter — 10 attempts per identifier per
 * 15 minutes — once four workers each authenticated for sixteen tests. The limiter was
 * doing its job; the suite was the thing behaving badly.
 *
 * Playwright's `storageState` is the standard answer: authenticate once, save the cookie
 * jar, and let every admin test start already signed in. It is also faster, and it means
 * the tests exercise the panel rather than re-testing login sixteen times.
 */
import { expect, test as setup } from '@playwright/test';

import { ADMIN_STATE } from './admin-state';

setup('authenticate as admin', async ({ request }) => {
  const identifier = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  expect(identifier, 'SEED_ADMIN_EMAIL must be set').toBeTruthy();
  expect(password, 'SEED_ADMIN_PASSWORD must be set').toBeTruthy();

  /**
   * Clear this identifier's login counter first.
   *
   * Phase 3 limits logins to 10 per identifier per 15 minutes and the limiter fails closed
   * — correct behaviour, and it means a suite that has been run a few times in quick
   * succession locks itself out. Resetting one known key gives the run a deterministic
   * starting point without weakening anything: the limiter itself is tested in Phase 3's
   * suite, and this file's job is the admin panel.
   *
   * Scoped to exactly the seed admin's counter. Nothing else is touched.
   */
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL!, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();

    /**
     * Every limiter this suite can exhaust, cleared for this machine only.
     *
     * Key shapes from lib/auth/rate-limit.ts, spoken to directly because Playwright does
     * not resolve the `@/` alias. The counters below are the ones a repeated local run
     * legitimately fills: logins (10/identifier/15min), calculator shares (20/IP/hour) and
     * enquiry beacons (60/IP/hour). Each limiter is tested on its own terms in the phase
     * that introduced it; resetting them here only stops the suite locking itself out.
     *
     * Scoped to the seed admin's identifier and to loopback addresses. Nothing else.
     */
    const keys = await redis.keys('rl:*');
    const mine = keys.filter(
      (key) =>
        key === `rl:login:id:${identifier!.toLowerCase()}` ||
        key.endsWith(':::1') ||
        key.endsWith(':127.0.0.1'),
    );
    if (mine.length > 0) await redis.del(...mine);
  } catch {
    // No Redis reachable — the login below will report the real problem.
  }

  /**
   * Two attempts, deliberately.
   *
   * The very first Redis command of a cold server process is rejected while the connection
   * opens (SEC-008). One throwaway attempt makes this independent of start-up timing.
   */
  await request.post('/api/auth/login', { data: { identifier, password } });
  const response = await request.post('/api/auth/login', {
    data: { identifier, password },
  });

  redis.disconnect();

  expect(response.ok(), `admin sign-in failed: ${response.status()}`).toBe(true);

  await request.storageState({ path: ADMIN_STATE });
});
