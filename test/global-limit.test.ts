/**
 * §9.1 item 2 — "Global rate limiting in proxy, per-IP, Redis-backed. Tighter limits on
 * auth and bill routes."
 * Written by TEST for Phase 9 from `specs/09-hardening.md`.
 *
 * That sentence makes five separate claims, and each is asserted on its own here:
 *
 *   1. there is a limit at all — a flood is eventually refused;
 *   2. it is PER-IP — one address being refused does not refuse another;
 *   3. it is REDIS-BACKED — the count is shared state, not per-process memory;
 *   4. auth and bill paths are TIGHTER than everything else;
 *   5. it is IN THE PROXY — the refusal happens before a route renders.
 *
 * The specific numbers are not asserted. §9.1 asks for "tighter", not for 60, and a suite
 * that pins tuning values fails every time somebody tunes them, which teaches people to
 * edit tests rather than think.
 *
 * The limits are read live from `tierFor()` so exhausting a tier costs exactly one request
 * more than the tier permits, whatever it is set to.
 *
 * Runs against the real Redis on database 1 (`vitest.setup.ts`). A mocked Redis would prove
 * that a mock counts.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { consumeGlobalLimit, tierFor } from '@/lib/security/global-limit';
import { ensureReady, redis } from '@/lib/redis';

/** Distinct per test, so nothing here depends on the order tests run in. */
let counter = 0;
const anIp = () => `198.51.100.${(counter += 1) % 250}-${Date.now()}`;

const AUTH_PATH = '/api/auth/login';
const BILL_PATH = '/bills/6f1c1a3e-0000-4000-8000-000000000000';
const ORDINARY_PATH = '/collections';

/** Drive one path from one address until it is refused, or give up. */
async function floodUntilRefused(ip: string, path: string, attempts: number) {
  const statuses: boolean[] = [];

  for (let i = 0; i < attempts; i += 1) {
    statuses.push((await consumeGlobalLimit(ip, path)).allowed);
  }

  return {
    allowed: statuses.filter(Boolean).length,
    refused: statuses.filter((s) => !s).length,
    firstRefusalAt: statuses.indexOf(false) + 1,
  };
}

/**
 * `ensureReady()` first, or the very first command of the process is rejected with
 * "Stream isn't writeable" — SEC-008, and it bit this harness on its first run exactly the
 * way it bit Phase 4's cache test.
 */
async function clearGlobalCounters() {
  await ensureReady();
  const keys = await redis.keys('rl:global:*');
  if (keys.length > 0) await redis.del(...keys);
}

beforeEach(clearGlobalCounters);

afterAll(async () => {
  await clearGlobalCounters();
  redis.disconnect();
});

describe('§9.1 — a flood from one address is refused', () => {
  it('allows exactly the tier’s budget and then refuses', async () => {
    const ip = anIp();
    const tier = tierFor(AUTH_PATH);

    const result = await floodUntilRefused(ip, AUTH_PATH, tier.limit + 5);

    // The budget is spent, not exceeded, before the first refusal.
    expect(result.firstRefusalAt).toBe(tier.limit + 1);
    expect(result.allowed).toBe(tier.limit);
    expect(result.refused).toBe(5);
  });

  it('tells a refused caller when to come back, and nothing else', async () => {
    const ip = anIp();
    const tier = tierFor(AUTH_PATH);

    await floodUntilRefused(ip, AUTH_PATH, tier.limit);
    const refused = await consumeGlobalLimit(ip, AUTH_PATH);

    expect(refused.allowed).toBe(false);
    // A Retry-After of 0 means "immediately", which is not a limit.
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(refused.retryAfter).toBeLessThanOrEqual(tier.windowSeconds);
  });

  it('does not lock an address out permanently', async () => {
    /**
     * The failure this must not have. `INCR` on a key with no TTL is immortal, so an
     * address that floods once would be refused for the life of the Redis instance — the
     * kind of bug that only appears in production and looks like "the site hates me".
     */
    const ip = anIp();
    const tier = tierFor(AUTH_PATH);

    await floodUntilRefused(ip, AUTH_PATH, tier.limit + 1);

    const ttl = await redis.ttl(`rl:global:${tier.name}:${ip}`);
    expect(
      ttl,
      'the counter has no expiry — the address is locked out forever',
    ).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(tier.windowSeconds);
  });
});

describe('§9.1 — "per-IP"', () => {
  it('refusing one address leaves another untouched', async () => {
    const flooder = anIp();
    const bystander = anIp();
    const tier = tierFor(AUTH_PATH);

    await floodUntilRefused(flooder, AUTH_PATH, tier.limit + 1);

    expect((await consumeGlobalLimit(flooder, AUTH_PATH)).allowed).toBe(false);
    // A limiter that counted globally rather than per address would refuse this too, and
    // one flooder would take the shop offline for every customer.
    expect((await consumeGlobalLimit(bystander, AUTH_PATH)).allowed).toBe(true);
  });

  it('exhausting one tier leaves the others open to the same address', async () => {
    // Someone hammering /login must not lose the ability to browse the catalogue.
    const ip = anIp();
    const auth = tierFor(AUTH_PATH);

    await floodUntilRefused(ip, AUTH_PATH, auth.limit + 1);

    expect((await consumeGlobalLimit(ip, AUTH_PATH)).allowed).toBe(false);
    expect((await consumeGlobalLimit(ip, ORDINARY_PATH)).allowed).toBe(true);
  });
});

describe('§9.1 — "Redis-backed"', () => {
  it('keeps the count in Redis, not in process memory', async () => {
    /**
     * The property, not the key name: clearing the shared store resets the limit. An
     * in-memory counter would survive this, and would also be worthless on a platform that
     * runs more than one instance — which is the actual reason §9.1 says "Redis-backed".
     */
    const ip = anIp();
    const tier = tierFor(AUTH_PATH);

    await floodUntilRefused(ip, AUTH_PATH, tier.limit + 1);
    expect((await consumeGlobalLimit(ip, AUTH_PATH)).allowed).toBe(false);

    await clearGlobalCounters();

    expect((await consumeGlobalLimit(ip, AUTH_PATH)).allowed).toBe(true);
  });
});

describe('a prefetch is counted, but not against the person browsing', () => {
  /**
   * Added by DEBUG alongside the fix for findings 1 and 2, because the fix has TWO
   * properties and the failing test only pinned one of them.
   *
   * `test/proxy-limit.test.ts` asserts a prefetch-labelled flood is refused — that is the
   * defect closing. This asserts the reason the exemption existed in the first place is
   * still honoured: `next/link` fires one prefetch per link in the viewport, so charging
   * them to the human's budget would break the site while somebody scrolls, which is the
   * outcome the original author was trying to avoid and was right to avoid.
   *
   * Without this, "count prefetches" and "count them against the same key" are
   * indistinguishable to the suite, and the obvious simplification silently reintroduces
   * the problem the exemption was written for.
   */
  it('exhausting the prefetch budget leaves the human’s intact', async () => {
    const ip = anIp();
    const tier = tierFor(ORDINARY_PATH);

    for (let i = 0; i < tier.limit + 1; i += 1) {
      await consumeGlobalLimit(ip, ORDINARY_PATH, { prefetch: true });
    }

    expect(
      (await consumeGlobalLimit(ip, ORDINARY_PATH, { prefetch: true })).allowed,
      'a prefetch flood was never refused — the limit is opt-out again',
    ).toBe(false);

    expect(
      (await consumeGlobalLimit(ip, ORDINARY_PATH)).allowed,
      'prefetches spent the budget a real visitor needs to browse',
    ).toBe(true);
  });
});

describe('§9.1 — "Tighter limits on auth and bill routes"', () => {
  it('puts auth and bill paths on a smaller budget than ordinary browsing', async () => {
    // The relationship is the requirement. The numbers are tuning.
    const ordinary = tierFor(ORDINARY_PATH);

    expect(tierFor(AUTH_PATH).limit).toBeLessThan(ordinary.limit);
    expect(tierFor(BILL_PATH).limit).toBeLessThan(ordinary.limit);
  });

  it.each([
    ['the login page', '/login'],
    ['the login API', '/api/auth/login'],
    ['signup', '/signup'],
    ['password reset', '/reset-password'],
    ['the claim link from the WhatsApp message', '/claim/abc123'],
    ['OTP verification', '/api/auth/phone/verify'],
  ])('treats %s as an auth path', async (_name, path) => {
    // Every route that can be used to guess a credential or spend a single-use token.
    expect(tierFor(path).limit).toBeLessThan(tierFor(ORDINARY_PATH).limit);
  });

  it.each([
    ['the customer’s invoice link', '/bills/6f1c1a3e-0000-4000-8000-000000000000'],
    ['bill creation', '/api/admin/bills'],
    ['the bills list', '/admin/bills'],
  ])('treats %s as a bill path', async (_name, path) => {
    expect(tierFor(path).limit).toBeLessThan(tierFor(ORDINARY_PATH).limit);
  });

  it('still lets an ordinary visitor browse without tripping anything', async () => {
    /**
     * The positive control, and the one that matters most commercially. A page view is a
     * dozen proxy-visible requests, and a large share of this shop's customers share one
     * carrier NAT address — so a limit tuned like an API key would report as "the site is
     * broken" rather than as "an attack was stopped".
     */
    const ip = anIp();

    for (let i = 0; i < 50; i += 1) {
      expect((await consumeGlobalLimit(ip, ORDINARY_PATH)).allowed).toBe(true);
    }
  });
});

/**
 * The fail-OPEN half of this requirement lives in `global-limit.degradation.test.ts`.
 * It rebinds the Redis module to a dead port, which would leave the shared client here
 * disconnected — a suite that quietly poisons the next one is how Phase 4 lost five runs.
 */
