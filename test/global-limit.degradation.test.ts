/**
 * §9.1 item 2, the half that inverts the usual rule — the global limiter must fail **OPEN**.
 * Written by TEST for Phase 9 from `specs/09-hardening.md`.
 *
 * §9.5: "Redis down → slower, functional", and the graceful-degradation checklist is an
 * acceptance criterion of this phase ("Graceful degradation verified by killing each
 * dependency"). Phase 1 TEST verified that degradation for the site as a whole; a global
 * limiter that denied on a Redis fault would undo it for every page at once — one dependency
 * being down would mean the shop is down.
 *
 * This is the opposite of `lib/auth/rate-limit.ts`, which fails CLOSED and must keep doing
 * so: losing that one is a credential-guessing vulnerability, losing this one is a lost
 * flood mitigation. Both directions are asserted, in this file, so nobody "fixes the
 * inconsistency" in either direction without a red test.
 *
 * In its own file because rebinding the Redis module to a dead port would leave the shared
 * client in `global-limit.test.ts` disconnected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Port 1 is privileged and nothing listens there — connections fail immediately. */
const DEAD_REDIS = 'redis://127.0.0.1:1/0';

const ORDINARY_PATH = '/collections';
const AUTH_PATH = '/api/auth/login';

/**
 * Rebind the Redis module to a dead port and re-import what depends on it.
 *
 * `vi.resetModules()` alone is not enough: outside production `lib/redis.ts` memoises its
 * client on `globalThis` to survive Next's hot reload, so a reset hands back the FIRST
 * client ever constructed. The technique is Phase 1's, in `lib/redis.test.ts`.
 */
async function withDeadRedis<T>(load: () => Promise<T>): Promise<T> {
  const globalForRedis = globalThis as { redis?: { disconnect: () => void } };
  globalForRedis.redis?.disconnect();
  delete globalForRedis.redis;

  vi.resetModules();
  vi.stubEnv('REDIS_URL', DEAD_REDIS);
  return load();
}

beforeEach(() => {
  // Both limiters log their faults; keep the suite output readable.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('the global limiter fails OPEN — a Redis outage is not a site outage', () => {
  it('allows every request when Redis is unreachable', async () => {
    const { consumeGlobalLimit } = await withDeadRedis(
      () => import('@/lib/security/global-limit'),
    );

    for (let i = 0; i < 25; i += 1) {
      const result = await consumeGlobalLimit('203.0.113.77', ORDINARY_PATH);
      expect(result.allowed, `request ${i + 1} was refused with Redis down`).toBe(true);
    }
  });

  it('fails open on the auth tier too', async () => {
    /**
     * Deliberately including auth. The per-route limiter inside the handler fails closed
     * and is the real credential-guessing control, so this outer wall giving up costs a
     * mitigation rather than the protection — which is the reasoning that makes the two
     * behaviours consistent rather than contradictory.
     */
    const { consumeGlobalLimit } = await withDeadRedis(
      () => import('@/lib/security/global-limit'),
    );

    expect((await consumeGlobalLimit('203.0.113.78', AUTH_PATH)).allowed).toBe(true);
  });

  it('does not block while Redis is unreachable', async () => {
    /**
     * Allowing the request is not enough if it takes 13 seconds to decide — that is a site
     * outage wearing a different hat, and it is precisely what SEC-008 measured when
     * `enableOfflineQueue: true` was tried as a fix.
     */
    const { consumeGlobalLimit } = await withDeadRedis(
      () => import('@/lib/security/global-limit'),
    );

    const started = Date.now();
    await consumeGlobalLimit('203.0.113.79', ORDINARY_PATH);

    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('the proxy serves the request rather than refusing it', async () => {
    /**
     * End of the wire, not just the module: §9.5's requirement is about what a visitor
     * gets, and the proxy is what decides that.
     */
    const { proxy } = await withDeadRedis(() => import('@/proxy'));
    const { NextRequest } = await import('next/server');

    const response = await proxy(
      new NextRequest('https://shop.example/collections', {
        headers: { 'x-forwarded-for': '203.0.113.80' },
      }),
    );

    expect(response.status).not.toBe(429);
  });
});

describe('the auth limiter still fails CLOSED — the inversion is deliberate', () => {
  it('denies when Redis is unreachable', async () => {
    /**
     * The other direction, asserted here so the two are read together. §3 SECURITY: a
     * limiter that fails open hands unlimited OTP attempts to anyone who can pressure
     * Redis. If somebody ever unifies these two modules "for consistency", one of these two
     * suites goes red.
     */
    const { consume } = await withDeadRedis(() => import('@/lib/auth/rate-limit'));

    const result = await consume({
      key: 'login:ip:203.0.113.81',
      limit: 30,
      windowSeconds: 900,
    });

    expect(result.allowed).toBe(false);
  });

  it('does not print the identifier it is failing closed on (§9.1 item 9)', async () => {
    /**
     * The second half of SEC-031, which only happens on this path.
     *
     * Rate-limit keys embed the identifier by construction — `login:id:+919876543210`,
     * `otp:send:id:ravi@example.com` — so the fail-closed branch logged a phone number or
     * an email on every Redis fault. And a Redis fault is precisely when that branch runs
     * for every request at once, so the leak arrives in volume.
     */
    const { consume } = await withDeadRedis(() => import('@/lib/auth/rate-limit'));

    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l) => void lines.push(String(l)));

    await consume({
      key: 'login:id:+919812345678',
      limit: 10,
      windowSeconds: 900,
    });

    const output = lines.join('\n');
    expect(output).not.toContain('9812345678');
    // The key's SHAPE is what makes the line worth logging, so it must survive.
    expect(output).toContain('login:id:');
  });
});
