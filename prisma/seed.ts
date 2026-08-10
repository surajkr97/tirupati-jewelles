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
import { assertLocalDatabase, env } from '../lib/env';

// D-054: a seed against production would overwrite the shop's own settings row and admin.
assertLocalDatabase(env.DATABASE_URL, 'pnpm seed');

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
  /** Phase 8 §8.3 — the logo printed at the top of every bill PDF. */
  'BILL_LOGO',
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

/**
 * Demo catalogue (Phase 6 §6.1, §6.2).
 *
 * Phase 7 gives the admin real product CRUD; until then the catalogue has nothing to
 * render, and "browsable and filterable" cannot be demonstrated or tested against an empty
 * table. These are placeholders with no images — Phase 2's `ImageFrame` shows a branded
 * monogram for a null URL, so they look deliberate rather than broken.
 *
 * Weights and making percentages are plausible for each piece, and the spread across
 * purities and price bands is deliberate: it is what makes the §6.1 filters testable.
 *
 * Hallmark numbers are present on some and absent on others, because §6.2 requires the
 * trust block to read "Hallmark details available in store" rather than an empty box, and
 * that path needs a product to exercise it.
 */
const PRODUCTS = [
  // Rings
  {
    name: 'Classic Solitaire Ring',
    category: 'Rings',
    purity: 'K22_916',
    weightMg: 4_200,
    makingPct: 12,
    stoneCharge: 1_850_000n,
    hallmarkNo: 'HUID-4A7K2Q',
    bisCertNo: 'BIS-CM-9912345',
    featured: true,
  },
  {
    name: 'Everyday Gold Band',
    category: 'Rings',
    purity: 'K18_750',
    weightMg: 3_100,
    makingPct: 10,
    stoneCharge: 0n,
    hallmarkNo: 'HUID-8P3M1X',
    bisCertNo: 'BIS-CM-9912345',
  },
  // Necklaces
  {
    name: 'Temple Necklace Set',
    category: 'Necklaces',
    purity: 'K22_916',
    weightMg: 48_500,
    makingPct: 15,
    stoneCharge: 6_500_000n,
    hallmarkNo: 'HUID-2C9V7B',
    bisCertNo: 'BIS-CM-9912345',
    featured: true,
  },
  {
    name: 'Mangalsutra with Black Beads',
    category: 'Necklaces',
    purity: 'K22_916',
    weightMg: 18_750,
    makingPct: 12,
    stoneCharge: 0n,
    hallmarkNo: 'HUID-5N1D8G',
    bisCertNo: 'BIS-CM-9912345',
  },
  // Earrings
  {
    name: 'Jhumka Earrings',
    category: 'Earrings',
    purity: 'K22_916',
    weightMg: 12_400,
    makingPct: 15,
    stoneCharge: 950_000n,
    hallmarkNo: 'HUID-7T4L6R',
    bisCertNo: 'BIS-CM-9912345',
  },
  // Deliberately un-hallmarked, to exercise the §6.2 fallback copy.
  {
    name: 'Silver Oxidised Studs',
    category: 'Earrings',
    purity: 'SILVER_999',
    weightMg: 8_900,
    makingPct: 20,
    stoneCharge: 0n,
    hallmarkNo: null,
    bisCertNo: null,
  },
  // Bracelets & Chains
  {
    name: 'Rose Gold Tennis Bracelet',
    category: 'Bracelets',
    purity: 'K18_750',
    weightMg: 15_600,
    makingPct: 18,
    stoneCharge: 3_200_000n,
    hallmarkNo: 'HUID-3F8W5Z',
    bisCertNo: 'BIS-CM-9912345',
  },
  {
    name: 'Silver Charm Bracelet',
    category: 'Bracelets',
    purity: 'SILVER_999',
    weightMg: 22_000,
    makingPct: 22,
    stoneCharge: 0n,
    hallmarkNo: null,
    bisCertNo: null,
  },
  {
    name: 'Rope Chain 20 inch',
    category: 'Chains',
    purity: 'K22_916',
    weightMg: 26_300,
    makingPct: 10,
    stoneCharge: 0n,
    hallmarkNo: 'HUID-6H2J9K',
    bisCertNo: 'BIS-CM-9912345',
  },
  {
    name: 'Figaro Chain 18 inch',
    category: 'Chains',
    purity: 'K18_750',
    weightMg: 19_800,
    makingPct: 11,
    stoneCharge: 0n,
    hallmarkNo: 'HUID-1Q5S3Y',
    bisCertNo: 'BIS-CM-9912345',
  },
  // Bangles
  {
    name: 'Kada Bangle Pair',
    category: 'Bangles',
    purity: 'K22_916',
    weightMg: 62_400,
    makingPct: 14,
    stoneCharge: 0n,
    hallmarkNo: 'HUID-9Z6X4C',
    bisCertNo: 'BIS-CM-9912345',
    featured: true,
  },
  {
    name: 'Silver Anklet Pair',
    category: 'Bangles',
    purity: 'SILVER_999',
    weightMg: 45_000,
    makingPct: 18,
    stoneCharge: 0n,
    hallmarkNo: null,
    bisCertNo: null,
  },
] as const;

const DESCRIPTIONS: Record<string, string> = {
  Rings: 'Hand-finished and hallmarked, made to be worn every day.',
  Necklaces:
    'A statement piece in traditional craftsmanship, finished by hand in our workshop.',
  Earrings: 'Light enough for all-day wear, with secure backs.',
  Bracelets: 'A comfortable fit with a tested clasp.',
  Chains: 'A classic weave, evenly finished along its full length.',
  Bangles: 'Traditional weight and finish, sized in store.',
};

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

/**
 * Demo products (Phase 6). Upserted on slug, so a second run updates rather than
 * duplicates — the seed's standing rule.
 *
 * Deliberately does NOT touch `isActive`, `images` or any field Phase 7's admin will own:
 * once the shop starts editing these, re-running the seed must not undo their work. It
 * fills in the skeleton and stays out of the way.
 */
async function seedProducts(): Promise<void> {
  const categories = await db.category.findMany({ select: { id: true, slug: true } });
  const categoryIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  let count = 0;

  for (const product of PRODUCTS) {
    const categoryId = categoryIdBySlug.get(slugify(product.category));
    if (!categoryId) continue;

    const slug = slugify(product.name);
    const metal = product.purity === Purity.SILVER_999 ? Metal.SILVER : Metal.GOLD;

    await db.product.upsert({
      where: { slug },
      update: {},
      create: {
        name: product.name,
        slug,
        description: DESCRIPTIONS[product.category] ?? null,
        categoryId,
        metal,
        purity: product.purity,
        weightMg: product.weightMg,
        makingPct: product.makingPct,
        stoneCharge: product.stoneCharge,
        hasHallmark: product.hallmarkNo !== null,
        hallmarkNo: product.hallmarkNo,
        bisCertNo: product.bisCertNo,
        isFeatured: 'featured' in product ? product.featured : false,
      },
    });
    count += 1;
  }

  console.log(`  products     ${count}`);
}

async function main(): Promise<void> {
  console.log('Seeding…');
  const adminId = await seedAdmin();
  await seedCategories();
  await seedMediaSlots();
  await seedOpeningRates(adminId);
  await seedProducts();
  console.log('Done.');
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
