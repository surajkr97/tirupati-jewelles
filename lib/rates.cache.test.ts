/**
 * Phase 4 TEST — the cache path and the two public rate routes.
 * specs/04-rates-ticker.md, TEST section:
 *
 *   "Integration: setRate → Redis key deleted → getCurrentRates returns the new value."
 *   "Integration: /api/rates served from cache on the second call (assert via a DB query
 *    spy, not by timing)."
 *   "Redis down → /api/rates still returns correct data from Postgres."
 *
 * Runs against a real Postgres and a real Redis. The behaviour under test is
 * cache-aside — a key existing, being read, and being deleted — and a mocked Redis would
 * assert only that the mock forgets things when told to.
 */
import { Metal, Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Next's cache primitives read a request-scoped store that does not exist in a bare Node
// process. Mocked, not wrapped in try/catch inside setRate: swallowing a revalidation
// failure in production would show a customer a stale price and say nothing.
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { revalidatePath, revalidateTag } from 'next/cache';

import { GET as getRates } from '@/app/api/rates/route';
import { GET as getHistory } from '@/app/api/rates/history/route';
import { db } from '@/lib/db';
import {
  getCurrentRates,
  MAX_HISTORY_POINTS,
  RATES_CACHE_KEY,
  RATE_SURFACES,
  RATE_SURFACE_PATTERNS,
  RATES_TAG,
  setRate,
  toDisplayUnit,
} from '@/lib/rates';
import { invalidate, redis } from '@/lib/redis';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const GOLD_22 = { metal: Metal.GOLD, purity: Purity.K22_916 } as const;

let adminId: string;

async function seedRate(ratePerGram: bigint, effectiveAt?: Date) {
  await db.metalRate.create({
    data: { ...GOLD_22, ratePerGram, setByUserId: adminId, ...(effectiveAt && { effectiveAt }) },
  });
}

describeDb('rates cache', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();

    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY);

    const admin = await db.user.create({
      data: { email: `rates-cache-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY);
    await db.$disconnect();
    redis.disconnect();
  });

  it('reads Postgres on the first call and the cache on the second', async () => {
    await seedRate(1_184_200n);

    const spy = vi.spyOn(db.metalRate, 'findMany');

    const first = await getCurrentRates();
    const callsAfterFirst = spy.mock.calls.length;

    const second = await getCurrentRates();

    // A query spy, not a stopwatch — §4 TEST says so explicitly, and a timing assertion
    // would be flaky on a warm local Postgres that answers in under a millisecond.
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
    expect(second.gold22.perGram).toBe(first.gold22.perGram);
  });

  it('round-trips bigint paise through Redis without becoming a number', async () => {
    await seedRate(1_184_200n);

    await getCurrentRates();
    const cached = await getCurrentRates();

    // JSON.stringify throws on bigint, so lib/redis.ts tags them. If that ever regressed
    // to Number, money would silently start losing precision instead of failing loudly.
    expect(typeof cached.gold22.perGram).toBe('bigint');
    expect(cached.gold22.perGram).toBe(1_184_200n);
    expect(cached.gold22.display).toBe(11_842_000n);
  });

  it('setRate deletes the cache key so the next read sees the new value', async () => {
    await seedRate(1_184_200n);

    const before = await getCurrentRates();
    expect(before.gold22.perGram).toBe(1_184_200n);
    // The key is warm — this is the state that would serve a stale price.
    expect(await redis.get(RATES_CACHE_KEY)).not.toBeNull();

    await setRate({ ...GOLD_22, ratePerGram: 1_200_000n, userId: adminId });

    expect(await redis.get(RATES_CACHE_KEY)).toBeNull();

    const after = await getCurrentRates();
    expect(after.gold22.perGram).toBe(1_200_000n);
    expect(after.gold22.display).toBe(12_000_000n);
    // Change against the previous row, in the display unit.
    expect(after.gold22.change).toBe(158_000n);
  });

  it('setRate invalidates every ISR surface that renders a rate', async () => {
    await seedRate(1_184_200n);
    await setRate({ ...GOLD_22, ratePerGram: 1_200_000n, userId: adminId });

    /**
     * MASTER-SPEC §6 promises a rate change appears "without waiting for the ISR window".
     *
     * `revalidateTag` alone does not deliver that: Next 16 only invalidates entries that
     * carry the tag, and these pages are cached by `export const revalidate` with no
     * tagged data anywhere. Measured against a production build before this assertion was
     * written — `/api/rates` updated instantly while `/` and `/rates` served the old
     * figure for the full 300s.
     */
    expect(revalidateTag).toHaveBeenCalledWith(RATES_TAG, 'max');
    for (const path of RATE_SURFACES) {
      expect(revalidatePath).toHaveBeenCalledWith(path);
    }

    /**
     * Phase 6 added product and category pages, which price from the rate. They are
     * dynamic segments, so they need the `'page'` form — `revalidatePath('/products/x')`
     * would match one literal path and leave every other product stale.
     *
     * This is the discharge of the `@DEV:` note Phase 4 left against DEBT-014.
     */
    for (const pattern of RATE_SURFACE_PATTERNS) {
      expect(revalidatePath).toHaveBeenCalledWith(pattern, 'page');
    }
  });

  it('a rejected rate leaves the cache untouched', async () => {
    await seedRate(1_184_200n);
    await getCurrentRates();

    // 10× — the fat-finger typo. It must not bust the cache either, or a failed write
    // would still cost every reader a database round trip.
    const result = await setRate({
      ...GOLD_22,
      ratePerGram: 11_842_000n,
      userId: adminId,
    });

    expect(result.ok).toBe(false);
    expect(await redis.get(RATES_CACHE_KEY)).not.toBeNull();
    expect((await getCurrentRates()).gold22.perGram).toBe(1_184_200n);
  });
});

describeDb('GET /api/rates', () => {
  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY);

    const admin = await db.user.create({
      data: { email: `rates-route-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    adminId = admin.id;
    await seedRate(1_184_200n);
  });

  it('returns every money field as a string, never a JSON number', async () => {
    const body = await (await getRates()).json();

    // MASTER-SPEC §4. A JSON number would silently truncate above 2^53 and, worse, invite
    // the client to do float arithmetic on money.
    for (const key of ['gold22', 'gold18', 'silver999'] as const) {
      expect(typeof body[key].perGram).toBe('string');
      expect(typeof body[key].display).toBe('string');
      expect(typeof body[key].change).toBe('string');
    }

    expect(body.gold22.display).toBe('11842000');
    expect(body.gold22.unit).toBe('per 10 grams');
    expect(body.silver999.unit).toBe('per 1 kilogram');
  });

  it('carries the shared-cache window §4.2 specifies', async () => {
    const response = await getRates();
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=300');
  });

  it('serves the TRUE rate — nothing on this route can be jittered', async () => {
    const body = await (await getRates()).json();

    /**
     * The flagship separation (§4, MASTER-SPEC §8). The jitter lives in one client
     * component's React state; there is no code path from it back to a server, so the
     * value here is exactly what the admin set.
     *
     * §4 TEST's "open the calculator and assert it uses the true rate" cannot run until
     * Phase 5 builds the calculator. What is assertable today is that the endpoint the
     * calculator will read returns the stored rate untouched.
     */
    const stored = await db.metalRate.findFirst({
      where: GOLD_22,
      orderBy: { effectiveAt: 'desc' },
      select: { ratePerGram: true },
    });

    expect(body.gold22.perGram).toBe(stored?.ratePerGram.toString());
  });

  it('still returns correct data from Postgres when Redis is down', async () => {
    /**
     * Loads a second copy of the module graph bound to a dead Redis (the Phase 1 pattern).
     * MASTER-SPEC §7: "Redis being down must degrade to a slow site, never a broken one."
     * Phase 1 proved that for `cached()` in the abstract; this proves it for the route a
     * customer actually hits.
     */
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1/0');

    try {
      const { GET } = await import('@/app/api/rates/route');
      const response = await GET();

      expect(response.status).toBe(200);
      expect((await response.json()).gold22.perGram).toBe('1184200');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      vi.restoreAllMocks();
    }
  });
});

describeDb('GET /api/rates/history', () => {
  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();

    const admin = await db.user.create({
      data: { email: `hist-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });
    adminId = admin.id;
  });

  const call = (query: string) =>
    getHistory(new Request(`http://localhost/api/rates/history${query}`));

  it('returns the recorded points in ascending order', async () => {
    /**
     * The timestamps are explicit, and that is the point of the test rather than a detail.
     *
     * `effectiveAt` is `@default(now())`, and three `create` calls in a loop can land on the
     * same value — `now()` is the transaction timestamp, not a counter. `getRateHistory`
     * orders by `effectiveAt` alone, so a tie has no tiebreaker and Postgres may return any
     * permutation of the tied rows.
     *
     * It passed locally for four phases and failed on CI, which is the signature: the
     * assertion below is about ORDER, and until now the input had no defined order to
     * assert. Every sibling test in this file that cares about sequence already sets the
     * column explicitly — this was the one that did not.
     *
     * Fixed in the fixture rather than by adding `id` as a tiebreaker to `getRateHistory`:
     * two rates for the same metal and purity at the same microsecond is not a state the
     * application can reach, because `setRate` is one deliberate admin action at a time.
     */
    const base = Date.now() - 3 * 60 * 60 * 1000;
    const points: [bigint, Date][] = [
      [1_150_000n, new Date(base)],
      [1_170_000n, new Date(base + 60 * 60 * 1000)],
      [1_184_200n, new Date(base + 2 * 60 * 60 * 1000)],
    ];
    // Inserted out of order, so the assertion proves the QUERY sorts rather than the seed.
    for (const [rate, at] of [points[1]!, points[2]!, points[0]!]) await seedRate(rate, at);

    const response = await call('?metal=GOLD&purity=K22_916&days=30');
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.points.map((p: { rate: string }) => p.rate)).toEqual([
      '11500000',
      '11700000',
      '11842000',
    ]);
    expect(body.unit).toBe('per 10 grams');
    expect(body.days).toBe(30);
  });

  it('defaults to a 7-day window', async () => {
    await seedRate(1_184_200n);
    expect((await (await call('?metal=GOLD&purity=K22_916')).json()).days).toBe(7);
  });

  it('excludes points outside the window', async () => {
    await db.metalRate.create({
      data: {
        ...GOLD_22,
        ratePerGram: 900_000n,
        setByUserId: adminId,
        effectiveAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      },
    });
    await seedRate(1_184_200n);

    const body = await (await call('?metal=GOLD&purity=K22_916&days=30')).json();
    expect(body.points).toHaveLength(1);
    expect(body.points[0].rate).toBe('11842000');
  });

  it('converts silver to per-kilogram, not per-10g', async () => {
    await db.metalRate.create({
      data: {
        metal: Metal.SILVER,
        purity: Purity.SILVER_999,
        ratePerGram: 15_890n,
        setByUserId: adminId,
      },
    });

    const body = await (await call('?metal=SILVER&purity=SILVER_999')).json();
    expect(body.points[0].rate).toBe('15890000');
    expect(body.unit).toBe('per 1 kilogram');
  });

  it.each([
    ['no parameters', ''],
    ['unknown metal', '?metal=PLATINUM&purity=K22_916'],
    ['unknown purity', '?metal=GOLD&purity=K24'],
    ['purity from the wrong metal', '?metal=GOLD&purity=SILVER_999'],
    ['days below the floor', '?metal=GOLD&purity=K22_916&days=0'],
    ['days above the ceiling', '?metal=GOLD&purity=K22_916&days=9999'],
    ['days not a number', '?metal=GOLD&purity=K22_916&days=abc'],
    ['negative days', '?metal=GOLD&purity=K22_916&days=-7'],
    ['empty days', '?metal=GOLD&purity=K22_916&days='],
    ['float days', '?metal=GOLD&purity=K22_916&days=7.5'],
  ])('rejects %s with 400', async (_name, query) => {
    // SECURITY, every phase: "Reject, don't coerce." `z.coerce.number()` would turn the
    // empty string into 0 and `true` into 1 and quietly serve a result.
    expect((await call(query)).status).toBe(400);
  });

  it('caps the number of points and keeps the NEWEST ones', async () => {
    // The table is append-only and this route is public and unauthenticated, so without a
    // ceiling the response size grows with how long the shop has been trading.
    const overCap = MAX_HISTORY_POINTS + 25;
    await db.metalRate.createMany({
      data: Array.from({ length: overCap }, (_, i) => ({
        ...GOLD_22,
        ratePerGram: BigInt(1_000_000 + i),
        setByUserId: adminId,
        effectiveAt: new Date(Date.now() - (overCap - i) * 60_000),
      })),
    });

    const body = await (await call('?metal=GOLD&purity=K22_916&days=365')).json();

    expect(body.points).toHaveLength(MAX_HISTORY_POINTS);

    // Dropping the oldest, not the newest — truncating the other way would hide today's
    // rate behind last month's and is the easy mistake when adding a `take`.
    const last = body.points.at(-1).rate;
    expect(last).toBe(String(toDisplayUnit(Metal.GOLD, BigInt(1_000_000 + overCap - 1))));

    // Still chronological, because the sparkline draws left to right.
    const times = body.points.map((p: { at: string }) => Date.parse(p.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('never returns a rate as a JSON number', async () => {
    await seedRate(1_184_200n);

    const body = await (await call('?metal=GOLD&purity=K22_916')).json();
    for (const point of body.points) {
      expect(typeof point.rate).toBe('string');
    }
  });
});
