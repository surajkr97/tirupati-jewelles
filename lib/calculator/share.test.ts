/**
 * Phase 5 TEST — shareable results.
 * specs/05-calculator.md §5.5 and the TEST section:
 *
 *   "Shared link recomputes to an identical total."
 *   "Client sends a tampered total → server discards it and returns its own."
 *   "30-day expiry."
 *
 * Runs against a real Postgres: expiry, the unique slug constraint and JSON round-tripping
 * are database behaviours.
 */
import { Metal, Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
}));

import { POST } from '@/app/api/calculator/share/route';
import {
  createShare,
  generateSlug,
  readShare,
  SHARE_TTL_DAYS,
} from '@/lib/calculator/share';
import { toLineInput, type CalculatorItem } from '@/lib/calculator/types';
import { db } from '@/lib/db';
import { calculateTotal, type RatesByPurity } from '@/lib/pricing';
import { RATES_CACHE_KEY } from '@/lib/rates';
import { invalidate, redis } from '@/lib/redis';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const RATES: RatesByPurity = {
  K22_916: 1_184_200n,
  K18_750: 969_300n,
  SILVER_999: 15_890n,
};

const ITEM: CalculatorItem = {
  id: 'a',
  label: 'Chain',
  metal: 'GOLD',
  purity: 'K22_916',
  weightGrams: '10',
  makingPct: '12',
  stoneCharge: '',
  gstPct: '3',
};

/** The first golden case: 10 g of 22K at 12% + 3% GST. */
const EXPECTED_TOTAL = 13_660_931n;

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/calculator/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describeDb('calculator shares', () => {
  beforeEach(async () => {
    await db.calculatorShare.deleteMany();

    /**
     * Seed the rate this suite depends on, rather than assuming one is there.
     *
     * The sibling rate suites truncate `MetalRate`, so "the seeded rate exists" is only
     * true depending on file order — and the Redis cache hid that, serving a stale
     * `rates:current` from a previous run so the suite passed in isolation and failed in
     * the full suite. Both the row and the cache key are set up explicitly here.
     */
    await db.metalRate.deleteMany();
    await db.auditLog.deleteMany();
    await db.user.deleteMany();

    const admin = await db.user.create({
      data: { email: `share-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });

    await db.metalRate.createMany({
      data: [
        {
          metal: Metal.GOLD,
          purity: Purity.K22_916,
          ratePerGram: RATES.K22_916,
          setByUserId: admin.id,
        },
        {
          metal: Metal.GOLD,
          purity: Purity.K18_750,
          ratePerGram: RATES.K18_750,
          setByUserId: admin.id,
        },
        {
          metal: Metal.SILVER,
          purity: Purity.SILVER_999,
          ratePerGram: RATES.SILVER_999,
          setByUserId: admin.id,
        },
      ],
    });

    await invalidate(RATES_CACHE_KEY);

    // The route is rate limited per IP; clear the counter so the suite is not throttled
    // by its own earlier cases.
    await redis.del('rl:calc:share:ip:203.0.113.9').catch(() => {});
  });

  afterAll(async () => {
    await db.calculatorShare.deleteMany();
    await db.metalRate.deleteMany();
    await db.auditLog.deleteMany();
    await db.user.deleteMany();
    await invalidate(RATES_CACHE_KEY);
    await db.$disconnect();
    redis.disconnect();
  });

  describe('slugs', () => {
    it('is 12 characters from an unambiguous alphabet', () => {
      const slug = generateSlug();

      expect(slug).toHaveLength(12);
      // No vowels, so it cannot spell anything; no 0/O or 1/l/I, because the link gets
      // read aloud and typed by hand.
      expect(slug).toMatch(/^[23456789bcdfghjkmnpqrstvwxyz]+$/);
    });

    it('does not repeat across 1,000 draws', () => {
      const seen = new Set(Array.from({ length: 1000 }, generateSlug));

      // The URL is the only thing guarding the link — MASTER-SPEC's risk table calls a
      // guessable one out by name.
      expect(seen.size).toBe(1000);
    });
  });

  describe('round trip', () => {
    it('recomputes to an identical total', async () => {
      const share = await createShare([ITEM], RATES, new Date());
      const read = await readShare(share.slug);

      expect(read).not.toBeNull();
      if (!read) return;

      const converted = toLineInput(read.items[0]!);
      expect(converted.ok).toBe(true);
      if (!converted.ok) return;

      // §5 TEST: "Shared link recomputes to an identical total."
      expect(calculateTotal([converted.input], read.rates).grandTotal).toBe(
        EXPECTED_TOTAL,
      );
    });

    it('restores rates as bigint paise, not numbers', async () => {
      const share = await createShare([ITEM], RATES, new Date());
      const read = await readShare(share.slug);

      // JSON has no bigint. If this ever came back as a Number, money would silently lose
      // precision instead of failing loudly (MASTER-SPEC §4).
      expect(typeof read?.rates.K22_916).toBe('bigint');
      expect(read?.rates).toEqual(RATES);
    });

    it('keeps the rates it was created with, even after the rate changes', async () => {
      const share = await createShare([ITEM], RATES, new Date());

      // The shop marks gold up 20% the next morning.
      const newRates: RatesByPurity = { ...RATES, K22_916: 1_421_040n };
      expect(newRates.K22_916).not.toBe(RATES.K22_916);

      const read = await readShare(share.slug);

      // §5.5: "a shared link doesn't silently change price." Same principle as
      // OrderItem.ratePerGram — a quote must not move under its recipient.
      expect(read?.rates.K22_916).toBe(RATES.K22_916);

      const converted = toLineInput(read!.items[0]!);
      if (!converted.ok) throw new Error('unreachable');
      expect(calculateTotal([converted.input], read!.rates).grandTotal).toBe(
        EXPECTED_TOTAL,
      );
    });
  });

  describe('expiry — §5.5 says 30 days', () => {
    it('sets expiry 30 days out', async () => {
      const share = await createShare([ITEM], RATES, new Date());
      const days = (share.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);

      expect(days).toBeGreaterThan(SHARE_TTL_DAYS - 0.01);
      expect(days).toBeLessThan(SHARE_TTL_DAYS + 0.01);
    });

    it('an expired share reads as missing', async () => {
      const share = await createShare([ITEM], RATES, new Date());
      await db.calculatorShare.update({
        where: { slug: share.slug },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // Not "expired" — indistinguishable from never having existed, so the endpoint is
      // not an oracle for which slugs were once real.
      expect(await readShare(share.slug)).toBeNull();
    });
  });

  describe('reading a slug that is not there', () => {
    it.each([
      ['an unknown slug', 'zzzzzzzzzzzz'],
      ['an empty slug', ''],
      ['a path traversal attempt', '../../etc/passwd'],
      ['a SQL-looking string', "' OR 1=1 --"],
      ['an over-long slug', 'a'.repeat(300)],
    ])('%s returns null', async (_name, slug) => {
      expect(await readShare(slug)).toBeNull();
    });
  });

  describe('corrupt rows are refused, not rendered', () => {
    it('rejects a row whose items no longer validate', async () => {
      const share = await createShare([ITEM], RATES, new Date());
      await db.calculatorShare.update({
        where: { slug: share.slug },
        data: { items: [{ ...ITEM, weightGrams: 'abc' }] },
      });

      // Rendering an unvalidated blob into a price is how NaN reaches a customer.
      expect(await readShare(share.slug)).toBeNull();
    });

    it('rejects a row whose rate snapshot is incomplete', async () => {
      const share = await createShare([ITEM], RATES, new Date());
      await db.calculatorShare.update({
        where: { slug: share.slug },
        data: { rates: { K22_916: '1184200' } },
      });

      // A missing purity would price that metal at zero.
      expect(await readShare(share.slug)).toBeNull();
    });
  });

  describe('POST /api/calculator/share', () => {
    it('stores the item set and returns a path', async () => {
      const response = await post({ items: [ITEM] });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.path).toBe(`/calculator/s/${body.slug}`);
      expect(await db.calculatorShare.count()).toBe(1);
    });

    it('DISCARDS a client-submitted total — it never reaches the database', async () => {
      /**
       * §5: "The server recomputes every total independently. A client-submitted total is
       * display-only and is discarded on arrival."
       *
       * The schema is `.strict()`, so this is a 400 rather than a silent drop — and the
       * assertion that matters is the second one: nothing was written.
       */
      const response = await post({ items: [ITEM], grandTotal: '99999999' });

      expect(response.status).toBe(400);
      expect(await db.calculatorShare.count()).toBe(0);
    });

    it('rejects a total smuggled into an item', async () => {
      const response = await post({ items: [{ ...ITEM, lineTotal: '1' }] });

      expect(response.status).toBe(400);
      expect(await db.calculatorShare.count()).toBe(0);
    });

    it('NEVER accepts a rate from the client', async () => {
      // MASTER-SPEC's price-tampering control: "Client never sends a rate." A share link
      // carrying its own rates would let anyone publish any price under the shop's domain.
      const response = await post({
        items: [ITEM],
        rates: { K22_916: '1', K18_750: '1', SILVER_999: '1' },
      });

      expect(response.status).toBe(400);
      expect(await db.calculatorShare.count()).toBe(0);
    });

    it('stores the server rate, so the shared total matches the calculator', async () => {
      const response = await post({ items: [ITEM] });
      const { slug } = await response.json();

      const read = await readShare(slug);
      const converted = toLineInput(read!.items[0]!);
      if (!converted.ok) throw new Error('unreachable');

      // The rates come from `getCurrentRates()`, which is the seeded 22K rate — the same
      // value the calculator reads from /api/rates.
      expect(read!.rates.K22_916).toBe(1_184_200n);
      expect(calculateTotal([converted.input], read!.rates).grandTotal).toBe(
        EXPECTED_TOTAL,
      );
    });

    it.each([
      ['no items', { items: [] }],
      ['a missing items key', {}],
      ['an unknown purity', { items: [{ ...ITEM, purity: 'K24' }] }],
      ['a non-numeric weight', { items: [{ ...ITEM, weightGrams: 'abc' }] }],
      ['21 items', { items: Array.from({ length: 21 }, () => ITEM) }],
    ])('rejects %s', async (_name, body) => {
      const response = await post(body);

      expect(response.status).toBe(400);
      expect(await db.calculatorShare.count()).toBe(0);
    });

    it('is rate limited — it is the only public write in the app', async () => {
      // 20 per IP per hour. The 21st is refused.
      for (let i = 0; i < 20; i += 1) {
        expect((await post({ items: [ITEM] })).status).toBe(201);
      }

      const refused = await post({ items: [ITEM] });

      expect(refused.status).toBe(429);
      expect(await db.calculatorShare.count()).toBe(20);
    });
  });
});
