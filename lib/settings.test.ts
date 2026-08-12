/**
 * Phase 9 TEST — the shop's pricing defaults are actually READ (DEBT-024).
 *
 * DEBT-024 was not a bug in a calculation; it was a setting that was written, stored,
 * displayed back on the settings screen, and then ignored by every surface that prices
 * anything. Nothing failed, which is why it survived two phases. So the assertions here are
 * deliberately end-to-end rather than unit-level: change the row, and prove the money that
 * comes out of the catalogue changes with it.
 *
 * A real Postgres and a real Redis, because the behaviour under test is cache-aside over a
 * database row — a mocked client would only prove the mock returns what it was told to.
 */
import { Metal, Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { SPEC_ITEM_DEFAULTS } from '@/lib/calculator/types';
import { getProductBySlug, PRODUCT_CARD_SELECT } from '@/lib/catalog/products';
import { db } from '@/lib/db';
import { calculateLine } from '@/lib/pricing';
import { RATE_SURFACES, RATES_CACHE_KEY } from '@/lib/rates';
import { clientEnv } from '@/lib/env';
import { invalidate } from '@/lib/redis';
import {
  getPricingDefaults,
  getTickerJitter,
  invalidatePricingDefaults,
  invalidateTickerJitter,
  PRICING_DEFAULTS_KEY,
  SETTINGS_SURFACES,
  SPEC_PRICING_DEFAULTS,
} from '@/lib/settings';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const RATE_22K = 1_184_200n;

/** Write the singleton, then drop the cache — the ordering `applyPricingDefaultsChange` uses. */
async function setDefaults(gstPct: number, makingPct: number) {
  await db.settings.upsert({
    where: { id: 'singleton' },
    update: { defaultGstPct: gstPct, defaultMakingPct: makingPct },
    create: { id: 'singleton', defaultGstPct: gstPct, defaultMakingPct: makingPct },
  });
  await invalidatePricingDefaults();
}

describeDb('pricing defaults from Settings', () => {
  beforeEach(async () => {
    await db.productImage.deleteMany();
    await db.product.deleteMany();
    await db.category.deleteMany();
    await db.settings.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();
    await invalidate(PRICING_DEFAULTS_KEY, RATES_CACHE_KEY);

    const admin = await db.user.create({
      data: { email: `settings-${Date.now()}@example.com`, role: Role.ADMIN },
      select: { id: true },
    });

    await db.metalRate.create({
      data: {
        metal: Metal.GOLD,
        purity: Purity.K22_916,
        ratePerGram: RATE_22K,
        setByUserId: admin.id,
      },
    });
  });

  afterAll(async () => {
    // Leave nothing behind: a Settings row with an unusual GST rate would silently reprice
    // every other integration suite. DEBT-030's lesson, applied to a different backing store.
    await db.settings.deleteMany();
    await invalidate(PRICING_DEFAULTS_KEY);
  });

  it('falls back to the MASTER-SPEC figures when there is no Settings row', async () => {
    expect(await getPricingDefaults()).toEqual(SPEC_PRICING_DEFAULTS);
    expect(SPEC_PRICING_DEFAULTS).toEqual({ gstPct: 3, makingPct: 12 });
  });

  it('reads what the owner saved', async () => {
    await setDefaults(5, 15);
    expect(await getPricingDefaults()).toEqual({ gstPct: 5, makingPct: 15 });
  });

  it('keeps the decimals the Decimal(5,2) column stores', async () => {
    await setDefaults(1.5, 7.25);
    expect(await getPricingDefaults()).toEqual({ gstPct: 1.5, makingPct: 7.25 });
  });

  it('refuses a percentage the engine would throw on, per field', async () => {
    // Not reachable through the admin form, which validates on write — but reachable by a
    // seed, a migration or a manual psql edit, and `calculateLine` runs on the render path
    // of every product card. A bad row must misprice nothing, not 500 the storefront.
    await setDefaults(150, 15);

    const defaults = await getPricingDefaults();
    expect(defaults.gstPct).toBe(SPEC_PRICING_DEFAULTS.gstPct);
    // The other field is untouched: one bad value does not discard a good one.
    expect(defaults.makingPct).toBe(15);
  });

  it('is served from cache, and the cache is droppable', async () => {
    await setDefaults(5, 15);

    const spy = vi.spyOn(db.settings, 'findUnique');
    try {
      await getPricingDefaults();
      const afterFirst = spy.mock.calls.length;
      await getPricingDefaults();
      expect(spy.mock.calls.length, 'second call should be a cache hit').toBe(afterFirst);

      await invalidatePricingDefaults();
      await getPricingDefaults();
      expect(spy.mock.calls.length, 'invalidation should force a re-read').toBe(
        afterFirst + 1,
      );
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * The flagship assertion. Everything above proves the module reads the row; this proves
   * the storefront prices with it, which is the sentence DEBT-024 actually says.
   */
  it('a change to defaultGstPct changes the product price', async () => {
    const category = await db.category.create({
      data: { name: 'Rings', slug: 'rings', sortOrder: 0 },
      select: { id: true },
    });
    await db.product.create({
      data: {
        name: 'Plain band',
        slug: 'plain-band',
        categoryId: category.id,
        metal: Metal.GOLD,
        purity: Purity.K22_916,
        weightMg: 8475,
        makingPct: 12,
        stoneCharge: 0n,
        isActive: true,
      },
    });

    const row = await db.product.findFirstOrThrow({
      where: { slug: 'plain-band' },
      select: PRODUCT_CARD_SELECT,
    });

    // Computed here from the engine at each rate, never read back from the page.
    const expectedAt = (gstPct: number) =>
      calculateLine(
        {
          metal: 'GOLD',
          purity: 'K22_916',
          weightMg: 8475,
          makingPct: 12,
          stoneCharge: 0n,
          gstPct,
        },
        RATE_22K,
      ).lineTotal;

    await setDefaults(3, 12);
    const atThree = await getProductBySlug('plain-band');
    expect(atThree?.price.lineTotal).toBe(expectedAt(3));
    expect(atThree?.gstPct).toBe(3);

    await setDefaults(5, 12);
    const atFive = await getProductBySlug('plain-band');
    expect(atFive?.price.lineTotal).toBe(expectedAt(5));
    expect(atFive?.gstPct).toBe(5);

    // And the two really are different, or the assertions above would both pass against a
    // hardcoded constant.
    expect(atFive?.price.lineTotal).not.toBe(atThree?.price.lineTotal);
    expect(row.makingPct.toNumber()).toBe(12);
  });
});

/**
 * Structural, so it runs without a database.
 *
 * DEBT-014's failure mode transplanted: a surface that renders a settings-derived figure and
 * is not on this list serves a stale one for its whole ISR window after the owner changes it.
 * Iterating the exported constant means a new surface added without an entry fails here.
 */
describe('SETTINGS_SURFACES', () => {
  it('covers every rate surface, because GST is priced into all of them', () => {
    for (const surface of RATE_SURFACES) {
      expect(SETTINGS_SURFACES).toContain(surface);
    }
  });

  it('includes /calculator, which renders the prefill server-side', () => {
    expect(SETTINGS_SURFACES).toContain('/calculator');
  });
});

/**
 * The fallback pair is written down twice and must stay one figure.
 *
 * `lib/settings.ts` is `server-only` and `lib/calculator/types.ts` is client code, so the
 * shop's defaults cross that boundary as props and each side keeps its own no-settings
 * fallback. Two copies of a number drift, and here they would drift into a calculator whose
 * blank line is prefilled with a different GST rate from the one the storefront prices with
 * — on the shop that has never opened §7.9, which is every shop on day one.
 *
 * Phase 2's contrast suite set this precedent by parsing `globals.css` rather than trusting
 * its Node-side mirror of the tokens.
 */
describe('the two spec fallbacks', () => {
  it('agree, because they are the same figure written in two modules', () => {
    expect(SPEC_ITEM_DEFAULTS).toEqual(SPEC_PRICING_DEFAULTS);
  });
});

/**
 * Stage 6 — the ticker off-switch, which was DEBT-024's shape a second time.
 *
 * `Settings.tickerJitter` has existed since §7.9. The admin screen wrote it, the change was
 * audited, `revalidatePath('/')` ran — and no storefront page ever SELECTed the column,
 * because `LiveRateCard` read `NEXT_PUBLIC_TICKER_JITTER` on its own. Setting the toggle to
 * Off left the rates moving. MASTER-SPEC §8 calls that switch the legal insurance, so a
 * switch that does nothing is the most expensive version of this defect in the codebase.
 *
 * Written against a real row and a real cache for the same reason the tests above are: what
 * is under test is cache-aside over a database column, and a mock would only prove itself.
 */
describeDb('the ticker off-switch is actually read', () => {
  /**
   * Restored to Default afterwards, and that is not politeness.
   *
   * This suite shares its database with the Playwright servers, and the storefront now READS
   * this column — which is the entire point of the change. Leaving it set to `false` turns
   * off the jitter for `e2e/rates.spec.ts`, whose positive control then fails somewhere
   * completely unrelated to whatever is being worked on. Found exactly that way.
   */
  afterAll(async () => {
    await setJitter(null);
  });

  async function setJitter(value: boolean | null) {
    await db.settings.upsert({
      where: { id: 'singleton' },
      update: { tickerJitter: value },
      create: { id: 'singleton', tickerJitter: value },
    });
    await invalidateTickerJitter();
  }

  it('returns false when the owner switches it off', async () => {
    await setJitter(false);
    expect(await getTickerJitter()).toBe(false);
  });

  it('returns true when the owner switches it on', async () => {
    await setJitter(true);
    expect(await getTickerJitter()).toBe(true);
  });

  it('falls back to the environment flag when the setting is Default', async () => {
    // Null is "follow NEXT_PUBLIC_TICKER_JITTER" — the schema comment's contract.
    await setJitter(null);
    expect(await getTickerJitter()).toBe(clientEnv.NEXT_PUBLIC_TICKER_JITTER);
  });

  it('picks up a change without waiting for the cache to expire', async () => {
    // The ordering `applyTickerJitterChange` uses: write, drop the cache, then revalidate.
    await setJitter(true);
    expect(await getTickerJitter()).toBe(true);

    await setJitter(false);
    expect(await getTickerJitter()).toBe(false);
  });
});
