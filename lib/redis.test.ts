/**
 * Phase 1 TEST: "Unit: cached() returns fetcher output when Redis is unreachable.
 * (Point it at a dead port and assert it still resolves.)"
 *
 * Acceptance criterion 4: "Redis helper degrades gracefully — verified by test, not by
 * inspection." Every later phase reads through this helper, so if it can throw, a Redis
 * blip becomes a site outage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Port 1 is privileged and nothing listens there — connections fail immediately. */
const DEAD_REDIS = 'redis://127.0.0.1:1/0';

/**
 * Import a fresh copy of lib/redis.ts bound to `url`.
 *
 * `vi.resetModules()` alone is not enough. Outside production the module memoises its
 * client on `globalThis` to survive Next's hot reload, so a reset re-runs the file and
 * then hands back the FIRST client ever constructed — at the first URL any test used.
 * Every suite here would silently share one connection and `stubEnv` would do nothing.
 * The previous client is disconnected as well, or its retry loop keeps running for the
 * rest of the process.
 */
async function importRedisModule(url: string) {
  const globalForRedis = globalThis as { redis?: { disconnect: () => void } };
  globalForRedis.redis?.disconnect();
  delete globalForRedis.redis;

  vi.resetModules();
  vi.stubEnv('REDIS_URL', url);
  return import('@/lib/redis');
}

describe('cached() with an unreachable Redis', () => {
  beforeEach(() => {
    // The helper logs each fault; keep the suite output readable.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves with the fetcher result instead of throwing', async () => {
    const { cached } = await importRedisModule(DEAD_REDIS);

    const result = await cached('phase1:test:miss', 60, async () => 'from-postgres');

    expect(result).toBe('from-postgres');
  });

  it('calls the fetcher exactly once per call', async () => {
    const { cached } = await importRedisModule(DEAD_REDIS);
    const fetcher = vi.fn(async () => ({ value: 42 }));

    await cached('phase1:test:once', 60, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('still returns bigint payloads — money is bigint paise (MASTER-SPEC §4)', async () => {
    const { cached } = await importRedisModule(DEAD_REDIS);

    const result = await cached('phase1:test:bigint', 60, async () => ({
      ratePerGram: 1_184_200n,
    }));

    expect(result.ratePerGram).toBe(1_184_200n);
  });

  it('propagates fetcher errors — a dead database is a real error, not a cache miss', async () => {
    const { cached } = await importRedisModule(DEAD_REDIS);

    await expect(
      cached('phase1:test:throws', 60, async () => {
        throw new Error('postgres is down');
      }),
    ).rejects.toThrow('postgres is down');
  });

  it('reports unhealthy rather than throwing', async () => {
    const { redisHealthy } = await importRedisModule(DEAD_REDIS);

    await expect(redisHealthy()).resolves.toBe(false);
  });

  it('invalidate() swallows the fault so a failed bust cannot fail the mutation', async () => {
    const { invalidate } = await importRedisModule(DEAD_REDIS);

    await expect(invalidate('rates:current')).resolves.toBeUndefined();
  });
});

/**
 * Regression — the cold-start window (found during Phase 4).
 *
 * `lazyConnect` opened the connection on the FIRST command, and `enableOfflineQueue:
 * false` rejected that same command with "Stream isn't writeable". So on a perfectly
 * healthy Redis the first calls of every process failed:
 *
 *   `cached()`   — could not warm the key, because a failed GET returned before the SET.
 *                  Phase 4's "served from cache on the second call" failed 5 runs of 5.
 *   rate limiter — fails closed by design, so the first login attempt after every deploy
 *                  was answered 429 and then worked on retry.
 *
 * These run against the REAL Redis, because the bug only exists in the gap between
 * "client constructed" and "socket ready" — a gap a mock does not have.
 */
const describeLive = process.env.REDIS_URL ? describe : describe.skip;

describeLive('cold start on a healthy Redis', () => {
  const LIVE_REDIS = process.env.REDIS_URL ?? '';

  it('the very first cached() call populates the key', async () => {
    const { cached, redis } = await importRedisModule(LIVE_REDIS);
    const key = `phase1:coldstart:${Date.now()}`;

    try {
      // First call of a brand-new module instance — the exact moment that used to fail.
      const first = await cached(key, 60, async () => ({ value: 'from-postgres' }));
      expect(first.value).toBe('from-postgres');

      // The proof: the key exists, so the next reader is served from cache.
      expect(await redis.get(key)).not.toBeNull();

      const fetcher = vi.fn(async () => ({ value: 'should-not-run' }));
      expect((await cached(key, 60, fetcher)).value).toBe('from-postgres');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await redis.del(key);
      redis.disconnect();
    }
  });

  it('the very first rate-limit check is allowed, not denied', async () => {
    const { redis } = await importRedisModule(LIVE_REDIS);
    const { consume } = await import('@/lib/auth/rate-limit');
    const key = `coldstart:${Date.now()}`;

    try {
      // The limiter fails closed, so a connect-window rejection reads as "rate limited"
      // to a user who has done nothing. This is the first command of the process.
      const result = await consume({ key, limit: 5, windowSeconds: 60 });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    } finally {
      await redis.del(`rl:${key}`);
      redis.disconnect();
    }
  });
});

describe('bigint-safe serialisation', () => {
  it('round-trips bigint through the cache encoding', async () => {
    const { serialise, deserialise } = await importRedisModule(DEAD_REDIS);

    const original = { perGram: 1_184_200n, per10g: 11_842_000n, label: 'gold22' };
    const restored = deserialise<typeof original>(serialise(original));

    expect(restored).toEqual(original);
    expect(typeof restored.perGram).toBe('bigint');
  });

  it('plain JSON.stringify would have thrown on this payload', () => {
    // Documents *why* the custom encoder exists — if this ever stops throwing, the
    // bigint handling in lib/redis.ts is no longer load-bearing.
    expect(() => JSON.stringify({ paise: 1n })).toThrow(TypeError);
  });
});
