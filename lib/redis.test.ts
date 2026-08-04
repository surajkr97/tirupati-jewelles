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

async function importRedisModule(url: string) {
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
