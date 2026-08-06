/**
 * §9.1 item 2, the wiring — "Global rate limiting **in proxy**".
 * Written by TEST for Phase 9 from `specs/09-hardening.md`.
 *
 * `global-limit.test.ts` proves the counter counts. This proves the counter is actually
 * consulted before a route renders, and that a refused caller gets a usable refusal. A
 * limiter nothing calls is the most expensive kind of passing test.
 *
 * It drives the real exported `proxy()` with real `NextRequest`s. Nothing here mocks the
 * limiter — the question is whether the two are connected.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureReady, redis } from '@/lib/redis';
import { tierFor } from '@/lib/security/global-limit';
import { proxy } from '@/proxy';
import { NextRequest } from 'next/server';

const AUTH_PATH = '/login';

let counter = 0;
const anIp = () => `198.51.100.${(counter += 1) % 250}-proxy-${Date.now()}`;

function request(path: string, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://shop.example${path}`, {
    headers: { 'x-forwarded-for': ip, ...headers },
  });
}

async function clearGlobalCounters() {
  // ensureReady() first — SEC-008, the first command of a process is otherwise rejected.
  await ensureReady();
  const keys = await redis.keys('rl:global:*');
  if (keys.length > 0) await redis.del(...keys);
}

/** Drive one path through the proxy N times and collect the statuses. */
async function driveProxy(
  path: string,
  ip: string,
  times: number,
  headers: Record<string, string> = {},
) {
  const statuses: number[] = [];
  for (let i = 0; i < times; i += 1) {
    statuses.push((await proxy(request(path, ip, headers))).status);
  }
  return statuses;
}

beforeEach(clearGlobalCounters);

afterAll(async () => {
  await clearGlobalCounters();
  redis.disconnect();
});

describe('the proxy applies the limit before anything renders', () => {
  it('lets an ordinary request through', async () => {
    // The positive control. Without it, a proxy that refused everything would satisfy the
    // assertions below.
    const response = await proxy(request('/collections', anIp()));

    expect(response.status).toBe(200);
  });

  it('answers 429 once the address has spent its budget', async () => {
    const ip = anIp();
    const tier = tierFor('/login');

    const statuses = await driveProxy(AUTH_PATH, ip, tier.limit + 2);

    expect(statuses.slice(0, tier.limit).every((s) => s !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('tells the refused caller when to retry', async () => {
    const ip = anIp();
    const tier = tierFor('/login');

    await driveProxy(AUTH_PATH, ip, tier.limit);
    const refused = await proxy(request(AUTH_PATH, ip));

    expect(refused.status).toBe(429);
    // A 429 with no Retry-After leaves a well-behaved client guessing, and §9.4's monitors
    // reading it as an outage.
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(refused.headers.get('cache-control')).toContain('no-store');
  });

  it('says nothing about which limit was hit or what is left', async () => {
    /**
     * A limiter that reports its own state is a limiter an attacker can tune against —
     * they learn the window, the budget and which tier a path is on, for free.
     */
    const ip = anIp();
    const tier = tierFor('/login');

    await driveProxy(AUTH_PATH, ip, tier.limit);
    const refused = await proxy(request(AUTH_PATH, ip));
    const body = await refused.text();

    expect(body).not.toContain(String(tier.limit));
    expect(body).not.toContain(tier.name);
    expect(refused.headers.get('x-ratelimit-limit')).toBeNull();
    expect(refused.headers.get('x-ratelimit-remaining')).toBeNull();
  });

  it('does not refuse a second address caught behind the first', async () => {
    const flooder = anIp();
    const bystander = anIp();
    const tier = tierFor('/login');

    await driveProxy(AUTH_PATH, flooder, tier.limit + 1);

    expect((await proxy(request(AUTH_PATH, flooder))).status).toBe(429);
    expect((await proxy(request(AUTH_PATH, bystander))).status).not.toBe(429);
  });

  it('keys on the trusted hop, not on what the caller put in front of it', async () => {
    /**
     * SEC-032 stated as the property it exists to produce. If the leftmost
     * `x-forwarded-for` entry were used, a flooder would present a fresh identity per
     * request and never be refused — the limiter would be decorative rather than wrong.
     *
     * Here the rightmost entry (the one a trusted proxy wrote) is held constant while the
     * caller-supplied prefix varies. The budget must still run out.
     */
    const realIp = anIp();
    const tier = tierFor('/login');

    const statuses: number[] = [];
    for (let i = 0; i < tier.limit + 2; i += 1) {
      statuses.push(
        (await proxy(request(AUTH_PATH, `203.0.113.${i % 200}, ${realIp}`))).status,
      );
    }

    expect(statuses.at(-1)).toBe(429);
  });
});

describe('a caller must not be able to exempt itself from the limit', () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   *  THESE TWO ARE EXPECTED TO FAIL. They are written from §9.1's requirement, not from
   *  the implementation, and they are the TEST finding for this phase — see SIGNOFF.md,
   *  Phase 9 — TEST, findings 1 and 2.
   *
   *  `shouldSkip()` removes a request from the limiter entirely when it carries
   *  `next-router-prefetch`, `purpose: prefetch` or `x-purpose: prefetch`, or when the path
   *  is `/api/health`. All four are attacker-settable — a header is not a capability — so
   *  the "global" limit §9.1 asks for is opt-out for anyone who reads the source, and this
   *  repository is the source.
   *
   *  The exclusions themselves are RIGHT: `next/link` really does fire a prefetch per link,
   *  and §9.4 really does put uptime checks on `/api/health` where a 429 would report a
   *  false outage. What is wrong is that they are exemptions rather than tiers. A generous
   *  ceiling serves both purposes; an unbounded path serves only one.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  it.each([
    ['next-router-prefetch', { 'next-router-prefetch': '1' }],
    ['purpose: prefetch', { purpose: 'prefetch' }],
    ['x-purpose: prefetch', { 'x-purpose': 'prefetch' }],
  ])('still counts a flood that claims to be a prefetch (%s)', async (_name, extra) => {
    const ip = anIp();
    const tier = tierFor(AUTH_PATH);

    const statuses = await driveProxy(AUTH_PATH, ip, tier.limit * 2, extra);

    expect(
      statuses.includes(429),
      `${tier.limit * 2} requests carrying a prefetch header were all allowed — ` +
        'the global limit is opt-out',
    ).toBe(true);
  });

  it('still bounds a flood of the health endpoint', async () => {
    /**
     * `/api/health` runs a database query and a Redis ping on every hit, so an unbounded
     * one is a connection-pool exhaustion primitive pointed at the two dependencies §9.5
     * is about. §9.4 needs the monitor to get a 200, which a headroom tier gives it — it
     * does not need the path to be uncounted.
     */
    const ip = anIp();
    const statuses = await driveProxy('/api/health', ip, 1_200);

    expect(
      statuses.includes(429),
      '1,200 health checks from one address were all allowed — the path is uncounted',
    ).toBe(true);
  });
});
