/**
 * Redis singleton + the cache-aside helper.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.5). Key map in MASTER-SPEC §7.
 *
 * The contract every later phase depends on:
 *
 *   Redis down = slow site, not broken site.
 *
 * `cached()` never throws on a Redis fault. It logs, calls the fetcher, returns the result.
 * Phase 9 §9.5 verifies this by killing Redis in staging and browsing the site.
 */
import Redis from 'ioredis';

import { env } from '@/lib/env';

const globalForRedis = globalThis as unknown as { redis?: Redis };

function createClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    // Fail fast instead of queueing. A page render must not block for 30s because Redis
    // is down — it should miss the cache and go to Postgres immediately.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  // ioredis emits 'error' on an EventEmitter. With no listener attached, Node treats it as
  // an unhandled exception and kills the process — which would turn "Redis is down" into
  // "the site is down", the exact failure mode this module exists to prevent.
  client.on('error', (err: Error) => {
    logCacheFault('connection', err);
  });

  return client;
}

export const redis = globalForRedis.redis ?? createClient();
if (env.NODE_ENV !== 'production') globalForRedis.redis = redis;

// ───────────────────────────────────────────────────────── bigint-safe JSON

/**
 * MASTER-SPEC §4 makes every money value a `bigint`, and `JSON.stringify` throws
 * `TypeError: Do not know how to serialize a BigInt`. Phase 4 caches rates (paise per
 * gram) at `rates:current`, so the cache layer has to understand bigint or that phase
 * breaks the moment it touches Redis.
 */
const BIGINT_TAG = '__bigint__';

type TaggedBigInt = { [BIGINT_TAG]: string };

function isTaggedBigInt(v: unknown): v is TaggedBigInt {
  return (
    typeof v === 'object' &&
    v !== null &&
    BIGINT_TAG in v &&
    typeof (v as TaggedBigInt)[BIGINT_TAG] === 'string'
  );
}

export function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) =>
    typeof val === 'bigint'
      ? ({ [BIGINT_TAG]: val.toString() } satisfies TaggedBigInt)
      : val,
  );
}

export function deserialise<T>(raw: string): T {
  return JSON.parse(raw, (_key, val: unknown) =>
    isTaggedBigInt(val) ? BigInt(val[BIGINT_TAG]) : val,
  ) as T;
}

// ──────────────────────────────────────────────────────────── the helper

let faultCount = 0;

function logCacheFault(op: string, err: unknown): void {
  faultCount += 1;
  // Log the first few and then every hundredth. A down Redis with a per-second ticker
  // would otherwise produce thousands of identical lines and bury real errors.
  if (faultCount <= 3 || faultCount % 100 === 0) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[cache] ${op} failed (fault #${faultCount}), falling through: ${message}`,
    );
  }
}

/**
 * Cache-aside read.
 *
 * @param key          Redis key — see MASTER-SPEC §7 for the map.
 * @param ttlSeconds   TTL applied on write.
 * @param fetcher      Source of truth, called on miss or on any Redis fault.
 *
 * Redis faults are swallowed. Errors thrown by `fetcher` are NOT — a failing database is a
 * real error and must surface, not be disguised as an empty cache.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return deserialise<T>(hit);
  } catch (err) {
    logCacheFault(`get ${key}`, err);
    return fetcher();
  }

  const fresh = await fetcher();

  try {
    await redis.set(key, serialise(fresh), 'EX', ttlSeconds);
  } catch (err) {
    logCacheFault(`set ${key}`, err);
  }

  return fresh;
}

/** Best-effort invalidation. Never throws — a failed bust must not fail the mutation. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    logCacheFault(`del ${keys.join(', ')}`, err);
  }
}

/** Liveness probe for /api/health. Returns false rather than throwing. */
export async function redisHealthy(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}
