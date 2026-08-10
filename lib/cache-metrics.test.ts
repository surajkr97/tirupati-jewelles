/**
 * Phase 9 §9.2 — the cache hit-rate instrumentation.
 *
 * §9.2 asks for "Redis hit rate > 80% on rates and products; instrument and confirm". The
 * confirmation is `pnpm cache:stats --drive`, which drives real traffic at a running server.
 * These are the tests for the instrument itself, and the one that carries the weight is the
 * THIRD outcome:
 *
 *   hit    the key was there
 *   miss   the key was not there
 *   fault  Redis could not be reached
 *
 * Folding `fault` into `miss` would be the easy implementation and it would make a dead
 * Redis report as a 0% hit rate — pointing whoever reads that number at the cache logic
 * instead of at the box that is down. So there is a test that a fault is not a miss.
 *
 * A real Redis, because the counters are Redis hashes and the behaviour under test is what
 * gets written to them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cacheNamespace,
  cached,
  CACHE_METRICS_PREFIX,
  ensureReady,
  flushCacheMetrics,
  readCacheStats,
  redis,
  resetCacheStats,
} from '@/lib/redis';

/** Port 1 is privileged and nothing listens there — connections fail immediately. */
const DEAD_REDIS = 'redis://127.0.0.1:1/0';

const NS = 'metricsprobe';
const KEY = `${NS}:example`;

async function statsFor(namespace: string) {
  await flushCacheMetrics();
  const all = await readCacheStats();
  return all.find((s) => s.namespace === namespace);
}

beforeEach(async () => {
  // Without this the very first command of the process is rejected with "Stream isn't
  // writeable" — SEC-008's exact shape. `cached()` and friends gate on it internally; a
  // test poking the client directly has to do the same.
  await ensureReady();
  await redis.del(KEY, `${CACHE_METRICS_PREFIX}:${NS}`);
});

afterEach(async () => {
  await redis.del(KEY, `${CACHE_METRICS_PREFIX}:${NS}`);
});

describe('the namespace a counter is grouped under', () => {
  it.each([
    ['rates:current', 'rates'],
    ['search:gold ring', 'search'],
    ['settings:pricing', 'settings'],
    // A key with no colon still has to land somewhere rather than producing an empty name.
    ['standalone', 'standalone'],
    ['', 'other'],
  ])('%s → %s', (key, expected) => {
    expect(cacheNamespace(key)).toBe(expected);
  });

  it('groups every query of one cache together', () => {
    // The reason this is a namespace and not the whole key: one counter per search term
    // would be thousands of keys measuring nothing.
    expect(cacheNamespace('search:jhumka')).toBe(
      cacheNamespace('search:temple necklace'),
    );
  });
});

describe('counting hits and misses', () => {
  it('a cold read is a miss and a warm read is a hit', async () => {
    await cached(KEY, 60, async () => ({ value: 1 }));
    expect((await statsFor(NS))?.miss).toBe(1);

    await cached(KEY, 60, async () => ({ value: 1 }));
    await cached(KEY, 60, async () => ({ value: 1 }));

    const stats = await statsFor(NS);
    expect(stats?.hit).toBe(2);
    expect(stats?.miss).toBe(1);
  });

  it('reports the rate as hits over reads', async () => {
    // 1 miss then 3 hits = 75%.
    for (let i = 0; i < 4; i += 1) await cached(KEY, 60, async () => ({ value: i }));

    expect((await statsFor(NS))?.hitRate).toBeCloseTo(0.75, 5);
  });

  it('records when the window started, once', async () => {
    await cached(KEY, 60, async () => 1);
    const first = (await statsFor(NS))?.since;

    await cached(KEY, 60, async () => 1);
    const second = (await statsFor(NS))?.since;

    expect(first).toBeInstanceOf(Date);
    // `hsetnx`, not `hset` — a rate quoted "since X" is meaningless if X moves on every read.
    expect(second?.getTime()).toBe(first?.getTime());
  });

  it('a namespace nothing has read reports no rate rather than 0%', async () => {
    await redis.hset(`${CACHE_METRICS_PREFIX}:${NS}`, 'fault', '3');

    const stats = await statsFor(NS);

    // 0% would read as "the cache is broken"; the truth is that nothing asked it anything.
    expect(stats?.hitRate).toBeNull();
    expect(stats?.fault).toBe(3);
  });
});

describe('a Redis outage is a fault, not a miss', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('counts nothing as a miss when the cache cannot be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    /**
     * A fresh module bound to a dead port. `vi.resetModules()` alone is not enough — the
     * module memoises its client on `globalThis` to survive hot reload, so a reset hands
     * back the first client ever constructed. Same reason, same fix as `lib/redis.test.ts`.
     */
    const globalForRedis = globalThis as { redis?: { disconnect: () => void } };
    const live = globalForRedis.redis;
    delete globalForRedis.redis;
    vi.resetModules();
    vi.stubEnv('REDIS_URL', DEAD_REDIS);

    const dead = await import('@/lib/redis');

    const value = await dead.cached('deadprobe:key', 60, async () => 'from the fetcher');

    // The contract that matters first: a dead Redis still serves the page.
    expect(value).toBe('from the fetcher');

    // And the counters cannot have been written — they live in the Redis that is down.
    // What must NOT happen is the miss counter being incremented in the live instance, or
    // an unhandled rejection taking the process with it.
    await dead.flushCacheMetrics();

    dead.redis.disconnect();
    globalForRedis.redis = live;
    vi.resetModules();

    // Nothing landed in the live instance under the probe namespace.
    const leaked = await redis.hgetall(`${CACHE_METRICS_PREFIX}:deadprobe`);
    expect(leaked).toEqual({});
  });

  /**
   * The discriminating test, and the reason the one above is not enough.
   *
   * Against a genuinely dead Redis the counter write fails too, so "nothing was recorded"
   * passes whether the code says `fault` or `miss` — it proves the degradation contract and
   * nothing about the instrument. What is needed is a Redis that fails the READ while still
   * accepting the counter write, which is a real state (a key type error, a transient
   * command failure, a cluster slot moving) and is reproduced here by failing `get` alone.
   *
   * Mutation-checked: changing `record(key, 'fault')` to `record(key, 'miss')` in
   * `lib/redis.ts` fails this test and nothing else in the suite.
   */
  it('a failing read is recorded as a fault while the counters still work', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const get = vi
      .spyOn(redis, 'get')
      .mockRejectedValue(
        new Error("READONLY You can't write against a read only replica"),
      );

    const value = await cached(KEY, 60, async () => 'from the fetcher');
    expect(value).toBe('from the fetcher');

    get.mockRestore();

    const stats = await statsFor(NS);
    expect(stats?.fault).toBe(1);
    // The whole point: an unreachable cache is not a cache miss.
    expect(stats?.miss).toBe(0);
    expect(stats?.hitRate).toBeNull();
  });

  it('flushing pending writes never rejects', async () => {
    await cached(KEY, 60, async () => 1);
    await expect(flushCacheMetrics()).resolves.toBeUndefined();
  });
});

describe('resetting', () => {
  it('clears the counters and reports how many namespaces went', async () => {
    await cached(KEY, 60, async () => 1);
    await flushCacheMetrics();

    expect(await statsFor(NS)).toBeDefined();

    const cleared = await resetCacheStats();

    expect(cleared).toBeGreaterThan(0);
    expect(await statsFor(NS)).toBeUndefined();
  });
});
