/**
 * Phase 9 TEST — the shop's WhatsApp number is actually READ (DEBT-050).
 *
 * The same defect DEBT-024 had, in the field that ticket did not sweep. §7.9 gave the owner
 * an `ownerWhatsApp` input; the server action validated it, stored it and the settings
 * screen displayed it back — and every surface that builds a `wa.me` link read
 * `NEXT_PUBLIC_OWNER_WA` from the environment instead. Nothing failed. The owner would have
 * changed their number, seen it saved, and every customer would have kept messaging the old
 * one.
 *
 * So the assertions here are the ones that would have caught it: change the row, and prove
 * the number the SITE renders changes with it. A unit test of `getShopContact` alone would
 * not have — the old code did not call it, because it did not exist.
 *
 * A real Postgres and a real Redis, for `lib/settings.test.ts`'s reason: cache-aside over a
 * database row is the behaviour under test, and a mock proves only that the mock works.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { clientEnv } from '@/lib/env';
import { db } from '@/lib/db';
import { getShopContact, invalidateShopContact, SHOP_CONTACT_KEY } from '@/lib/settings';
import { invalidate } from '@/lib/redis';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

/**
 * Invented numbers, and deliberately NOT the one in `.env`.
 *
 * The first draft of this file used the shop's real number as the stored value, and
 * "the stored number wins over the environment" then failed for a silly reason: the two
 * were the same string, so the assertion could not distinguish them. A fixture that
 * happens to equal the thing it is being compared against tests nothing.
 */
const STORED = '918888800000';
const CHANGED = '917777700000';

/** Write the singleton, then drop the cache — the ordering `applyShopContactChange` uses. */
async function setNumber(ownerWhatsApp: string | null) {
  await db.settings.upsert({
    where: { id: 'singleton' },
    update: { ownerWhatsApp },
    create: { id: 'singleton', ownerWhatsApp },
  });
  await invalidateShopContact();
}

describeDb('the shop WhatsApp number', () => {
  beforeEach(async () => {
    await db.settings.deleteMany();
    await invalidate(SHOP_CONTACT_KEY);
  });

  it('comes from the Settings row the owner edits', async () => {
    await setNumber(STORED);

    const { ownerWhatsApp } = await getShopContact();

    expect(ownerWhatsApp).toBe(STORED);
    // The point of the ticket: it is NOT the environment value.
    expect(ownerWhatsApp).not.toBe(clientEnv.NEXT_PUBLIC_OWNER_WA);
  });

  it('falls back to the environment when the shop has never opened the settings screen', async () => {
    // No Settings row at all — the state a fresh install is in. A missing row must not mean
    // a missing WhatsApp link on every page of the site.
    const { ownerWhatsApp } = await getShopContact();

    expect(ownerWhatsApp).toBe(clientEnv.NEXT_PUBLIC_OWNER_WA);
  });

  it('falls back when the row is present but the number is null', async () => {
    await setNumber(null);

    const { ownerWhatsApp } = await getShopContact();

    expect(ownerWhatsApp).toBe(clientEnv.NEXT_PUBLIC_OWNER_WA);
  });

  /**
   * The admin action strips non-digits but never checks the LENGTH, so a two-character
   * number is a value the database will hold quite happily. Rendering `wa.me/12` on every
   * page is a link that fails inside WhatsApp — somewhere no developer is looking — so a
   * malformed row must lose to the environment rather than reach a customer.
   */
  it.each([
    ['too short', '12'],
    ['too long', '1234567890123456'],
    ['empty', ''],
  ])('refuses a malformed stored number (%s) and falls back', async (_label, stored) => {
    await setNumber(stored);

    const { ownerWhatsApp } = await getShopContact();

    expect(ownerWhatsApp).toBe(clientEnv.NEXT_PUBLIC_OWNER_WA);
  });

  it('changing the row changes the answer — the cache does not pin it', async () => {
    await setNumber(STORED);
    expect((await getShopContact()).ownerWhatsApp).toBe(STORED);

    await setNumber(CHANGED);

    expect((await getShopContact()).ownerWhatsApp).toBe(CHANGED);
  });

  it('a stale cache is what invalidation exists to prevent', async () => {
    await setNumber(STORED);
    await getShopContact(); // warms the cache

    // Write WITHOUT invalidating — what a save that forgot `applyShopContactChange` does.
    await db.settings.update({
      where: { id: 'singleton' },
      data: { ownerWhatsApp: CHANGED },
    });

    expect((await getShopContact()).ownerWhatsApp).toBe(STORED);

    await invalidateShopContact();

    expect((await getShopContact()).ownerWhatsApp).toBe(CHANGED);
  });
});

/**
 * The structural guard, and the one that actually stops this coming back.
 *
 * DEBT-050 was not a wrong value — it was four components importing config instead of
 * asking for the setting. A behavioural test cannot see a FIFTH surface added later that
 * does the same thing, because that surface has no test yet. This one reads the source.
 *
 * Deliberately scoped to the components that build a customer-facing WhatsApp link.
 * `lib/env.ts` legitimately mentions the variable (it defines it), and so does the
 * `getShopContact` fallback — those are the definition and the default, not a bypass.
 */
describe('no storefront surface reads the number from the environment', () => {
  const SURFACES = [
    'components/shell/footer.tsx',
    'components/shell/whatsapp-fab.tsx',
    'components/product/enquiry-bar.tsx',
    'components/product/policy-enquiry.tsx',
  ];

  it.each(SURFACES)('%s takes the number as a prop', async (file) => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(file, 'utf8');

    // Strip comments: these files explain the ticket by name, and prose about
    // `NEXT_PUBLIC_OWNER_WA` is documentation rather than a read.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

    expect(code).not.toContain('NEXT_PUBLIC_OWNER_WA');
    expect(code).toContain('ownerWhatsApp');
  });
});
