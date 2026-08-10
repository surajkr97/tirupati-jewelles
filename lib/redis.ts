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

/** How long a caller will wait for the very first connection before giving up on it. */
const CONNECT_TIMEOUT_MS = 1000;

function createClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    // Fail fast instead of queueing. A page render must not block for 30s because Redis
    // is down — it should miss the cache and go to Postgres immediately.
    //
    // The cost of this setting is that a command issued before the socket is up is
    // rejected rather than held. `ensureReady()` below closes that window; the offline
    // queue is the wrong tool because it also holds commands when Redis is genuinely
    // down, which measured at 13s per call against a dead port.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: CONNECT_TIMEOUT_MS,
    // NOT lazyConnect: see ensureReady().
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

/**
 * Resolves once the socket is usable — or immediately once it is known not to be.
 *
 * ── The bug this exists to prevent ──
 * With `lazyConnect` the connection only began on the first command, and with the offline
 * queue disabled that same command was rejected with "Stream isn't writeable". So the
 * first Redis calls of every process failed, deterministically, on a perfectly healthy
 * Redis:
 *
 *   `cached()`   — fell through to Postgres and, because a failed GET returns before the
 *                  SET, the cache could not warm until a later request. Phase 4's
 *                  "served from cache on the second call" failed 5 runs out of 5.
 *   rate limiter — deliberately FAILS CLOSED, so the first login attempt after every
 *                  deploy was answered "Too many attempts. Try again later." (429) and
 *                  then worked on retry. Reproduced against a production build.
 *
 * ── Why a gate rather than the offline queue ──
 * The queue also holds commands while Redis is genuinely down, waiting on the retry
 * strategy: measured at 13s per call against a dead port, which is exactly the "slow site"
 * MASTER-SPEC §7 forbids. This waits only for the FIRST connection attempt and is settled
 * for the life of the process afterwards, so:
 *
 *   healthy Redis — the first caller waits a few ms; every later one short-circuits on
 *                   `status === 'ready'` and pays nothing.
 *   dead Redis    — the first connection error settles the gate immediately, and every
 *                   caller after that fails fast and falls through to Postgres.
 *   Redis dies later — the gate is already settled, so nothing waits.
 *
 * Never rejects. A connection problem must surface as a cache miss, not an exception.
 */
let readyGate: Promise<void> | null = null;

export function ensureReady(): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();

  readyGate ??= new Promise<void>((resolve) => {
    const settle = () => {
      clearTimeout(timer);
      redis.off('ready', settle);
      redis.off('error', settle);
      redis.off('end', settle);
      resolve();
    };

    // A backstop for the case where neither event arrives — a firewalled host that
    // silently drops SYN packets rather than refusing them.
    const timer = setTimeout(settle, CONNECT_TIMEOUT_MS);

    redis.once('ready', settle);
    redis.once('error', settle);
    redis.once('end', settle);
  });

  return readyGate;
}

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

// ──────────────────────────────────────────────────── hit-rate instrumentation

/**
 * §9.2: "Redis hit rate > 80% on rates and products; instrument and confirm."
 *
 * ── Three outcomes, not two ──
 * `hit` and `miss` are the ratio the budget is about. `fault` is Redis being unreachable,
 * and it is counted separately on purpose: a fault is not a caching problem, it is an
 * outage, and folding the two together makes a dead Redis read as a 0% hit rate — which
 * points an investigation at the cache logic rather than at the box that is down.
 *
 * ── Fire-and-forget, and it must stay that way ──
 * Never awaited. This runs on the render path of every product card and every page that
 * shows a rate, and measuring a cache is not worth making the cache slower. The `.catch`
 * is not decoration: an unhandled promise rejection from a floating `incr` would take the
 * process down, which is the exact failure `lib/redis.ts` exists to prevent.
 *
 * ── Grouped by namespace, not by key ──
 * `search:gold ring` and `search:jhumka` are the same cache with different arguments; one
 * counter per query would be thousands of keys measuring nothing. The namespace is the
 * segment before the first colon, which is the shape MASTER-SPEC §7's key map already uses.
 */
export const CACHE_METRICS_PREFIX = 'metrics:cache';

export type CacheOutcome = 'hit' | 'miss' | 'fault';

export function cacheNamespace(key: string): string {
  return key.split(':')[0] || 'other';
}

/**
 * Writes still in flight, so a test can wait for them instead of sleeping.
 *
 * The counters are deliberately not awaited on the request path, which makes them a race
 * for anything that wants to assert on them. AGENTS.md rejects "add a `setTimeout` to fix a
 * race condition" as a fix, and it would be one here — so the pending promises are tracked
 * and `flushCacheMetrics()` awaits them. Production never calls it.
 */
const pending = new Set<Promise<unknown>>();

function record(key: string, outcome: CacheOutcome): void {
  const field = `${CACHE_METRICS_PREFIX}:${cacheNamespace(key)}`;

  const write = redis
    .hincrby(field, outcome, 1)
    // `since` is written once and left alone, so a rate can be quoted with a window rather
    // than as a bare percentage of an unknown period.
    .then(() => redis.hsetnx(field, 'since', String(Date.now())))
    .catch(() => {
      // Instrumentation must never be the reason a request fails, and a fault here is
      // already the thing being measured.
    })
    .finally(() => pending.delete(write));

  pending.add(write);
}

/** Await the in-flight counter writes. For tests and for `pnpm cache:stats`. */
export async function flushCacheMetrics(): Promise<void> {
  await Promise.all([...pending]);
}

export interface CacheStats {
  namespace: string;
  hit: number;
  miss: number;
  fault: number;
  /** Hits as a fraction of hits + misses. `null` when nothing has been read yet. */
  hitRate: number | null;
  since: Date | null;
}

/** Read the counters. For `pnpm cache:stats` and the §9.2 confirmation. */
export async function readCacheStats(): Promise<CacheStats[]> {
  await ensureReady();

  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(
      cursor,
      'MATCH',
      `${CACHE_METRICS_PREFIX}:*`,
      'COUNT',
      100,
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');

  const stats = await Promise.all(
    keys.sort().map(async (key): Promise<CacheStats> => {
      const raw = await redis.hgetall(key);
      const hit = Number(raw.hit ?? 0);
      const miss = Number(raw.miss ?? 0);
      const reads = hit + miss;

      return {
        namespace: key.slice(`${CACHE_METRICS_PREFIX}:`.length),
        hit,
        miss,
        fault: Number(raw.fault ?? 0),
        hitRate: reads > 0 ? hit / reads : null,
        since: raw.since ? new Date(Number(raw.since)) : null,
      };
    }),
  );

  return stats;
}

/** Zero the counters, so a measurement run starts from a known point. */
export async function resetCacheStats(): Promise<number> {
  await ensureReady();

  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(
      cursor,
      'MATCH',
      `${CACHE_METRICS_PREFIX}:*`,
      'COUNT',
      100,
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');

  if (keys.length) await redis.del(...keys);
  return keys.length;
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
  await ensureReady();

  let missed = false;

  try {
    const hit = await redis.get(key);
    if (hit !== null) {
      record(key, 'hit');
      return deserialise<T>(hit);
    }
    record(key, 'miss');
  } catch (err) {
    logCacheFault(`get ${key}`, err);
    // NOT counted as a miss — see `record`. A fault is Redis being unreachable, which is a
    // different fact from the key not being there, and averaging them together is how an
    // outage reads as a caching problem.
    record(key, 'fault');
    missed = true;
  }

  const fresh = await fetcher();

  // A failed GET no longer skips the SET. It used to return early, which meant a single
  // transient fault left the key cold until some later request happened to arrive while
  // Redis was healthy. The SET is attempted and allowed to fail on its own.
  if (!missed || redis.status === 'ready') {
    try {
      await redis.set(key, serialise(fresh), 'EX', ttlSeconds);
    } catch (err) {
      logCacheFault(`set ${key}`, err);
    }
  }

  return fresh;
}

/** Best-effort invalidation. Never throws — a failed bust must not fail the mutation. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await ensureReady();
  try {
    await redis.del(...keys);
  } catch (err) {
    logCacheFault(`del ${keys.join(', ')}`, err);
  }
}

/** Liveness probe for /api/health. Returns false rather than throwing. */
export async function redisHealthy(): Promise<boolean> {
  try {
    await ensureReady();
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}
