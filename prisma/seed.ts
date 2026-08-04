/**
 * Database seed.
 * Created by Phase 1 (specs/01-cleanup-scaffold.md §1.6).
 *
 * Must run clean twice in a row — every write below is an upsert or a guarded insert.
 * A seed that duplicates rows on a second run is a seed nobody dares re-run.
 *
 *   pnpm seed
 */
import { Metal, PrismaClient, Purity, Role } from '@prisma/client';

import { hashPassword } from '../lib/auth/argon2';
import { env } from '../lib/env';

const db = new PrismaClient();

const CATEGORIES = [
  'Rings',
  'Necklaces',
  'Earrings',
  'Bracelets',
  'Chains',
  'Bangles',
] as const;

/** Phase 7 §7.6 — every slot the admin can fill from the dashboard. */
const MEDIA_SLOTS = [
  'HERO_BANNER',
  'OFFER_STRIP',
  'CATEGORY_TILE_1',
  'CATEGORY_TILE_2',
  'CATEGORY_TILE_3',
  'CATEGORY_TILE_4',
  'CATEGORY_TILE_5',
  'CATEGORY_TILE_6',
  'FEATURE_BANNER',
  'ABOUT_IMAGE',
  'FOOTER_BG',
] as const;

/**
 * Opening rates, in PAISE PER GRAM (MASTER-SPEC §4).
 *
 * Placeholders so the site renders before the owner sets real ones — the admin replaces
 * them from /admin/rates on day one. Roughly market-plausible for Aug 2026:
 *   gold 22K  ₹11,842/g  → ₹1,18,420 per 10g
 *   gold 18K  ₹ 9,693/g  → ₹  96,930 per 10g
 *   silver    ₹   158.90/g → ₹1,58,900 per kg
 */
const OPENING_RATES = [
  { metal: Metal.GOLD, purity: Purity.K22_916, ratePerGram: 1_184_200n },
  { metal: Metal.GOLD, purity: Purity.K18_750, ratePerGram: 969_300n },
  { metal: Metal.SILVER, purity: Purity.SILVER_999, ratePerGram: 15_890n },
] as const;

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function seedAdmin(): Promise<string> {
  const email = env.SEED_ADMIN_EMAIL.toLowerCase().trim();
  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);

  // Re-hash on every run so rotating SEED_ADMIN_PASSWORD in .env actually takes effect.
  const admin = await db.user.upsert({
    where: { email },
    update: { passwordHash, role: Role.ADMIN },
    create: {
      email,
      passwordHash,
      name: 'Shop Owner',
      role: Role.ADMIN,
      emailVerified: true,
    },
    select: { id: true },
  });

  console.log(`  admin        ${email}`);
  return admin.id;
}

async function seedCategories(): Promise<void> {
  for (const [index, name] of CATEGORIES.entries()) {
    const slug = slugify(name);
    await db.category.upsert({
      where: { slug },
      update: { sortOrder: index },
      create: { name, slug, sortOrder: index },
    });
  }
  console.log(`  categories   ${CATEGORIES.length}`);
}

async function seedMediaSlots(): Promise<void> {
  for (const slotKey of MEDIA_SLOTS) {
    // Empty on purpose. Phase 2's ImageFrame renders a branded placeholder for a null
    // imageUrl, so an unfilled slot looks deliberate rather than broken.
    await db.mediaSlot.upsert({
      where: { slotKey },
      update: {},
      create: { slotKey },
    });
  }
  console.log(`  media slots  ${MEDIA_SLOTS.length}`);
}

/**
 * MetalRate is append-only — Phase 4 §4.1 inserts a new row per change so the table is an
 * audit trail. There is therefore no unique key to upsert against, and a naive seed would
 * add three more rows every run. Insert only when that metal+purity has no history at all.
 */
async function seedOpeningRates(setByUserId: string): Promise<void> {
  let inserted = 0;

  for (const rate of OPENING_RATES) {
    const existing = await db.metalRate.findFirst({
      where: { metal: rate.metal, purity: rate.purity },
      select: { id: true },
    });
    if (existing) continue;

    await db.metalRate.create({ data: { ...rate, setByUserId } });
    inserted += 1;
  }

  console.log(
    `  rates        ${inserted} inserted, ${OPENING_RATES.length - inserted} already present`,
  );
}

async function main(): Promise<void> {
  console.log('Seeding…');
  const adminId = await seedAdmin();
  await seedCategories();
  await seedMediaSlots();
  await seedOpeningRates(adminId);
  console.log('Done.');
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
