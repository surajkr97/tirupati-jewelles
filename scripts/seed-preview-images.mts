/**
 * Point every empty image field at the downloaded preview photography.
 *
 * Run `node scripts/fetch-photos.mjs` first — this only writes the URLs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREVIEW CONTENT ONLY. These are Pexels stock photos of somebody else's jewellery.
 *  They exist to answer design questions that empty frames cannot, and they must be
 *  replaced with the owner's own photography before launch — a product page showing a
 *  piece the shop does not sell misrepresents the product, at a real price. §9.8's "Real
 *  data seeded: actual products, real images" is this item.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Idempotent, and it will not touch a real photo ──
 * Every write is guarded on the current value being empty or already seeded. A Cloudinary
 * URL set from the admin panel is left alone, so this is safe to re-run after the owner has
 * started replacing images.
 *
 * Usage:  npx tsx scripts/seed-preview-images.mts [--clear]
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

import { readManifest, remoteUrlFor } from './lib/cloudinary-manifest.mts';

config({ path: '.env', quiet: true });

const PREFIX = '/photos/';

/**
 * Prefer Cloudinary once a photo has been uploaded.
 *
 * Without this, re-running the seeder after `upload-photos.mts --wire` would point the
 * database back at `/photos/x.jpg` — local files that are deleted once the upload has
 * happened, so every image on the site would 404. The manifest is the record of what is
 * actually hosted, so it wins whenever it has an answer.
 */
const manifest = readManifest();
const resolveUrl = (localPath: string): string =>
  remoteUrlFor(localPath, manifest) ?? localPath;
/** `/placeholders/` was an earlier generated set; treat it as seeded so it gets replaced. */
const SEEDED = [PREFIX, '/placeholders/', 'https://res.cloudinary.com/'];
const clear = process.argv.includes('--clear');

/**
 * The owner role, not the restricted runtime one. `DATABASE_URL` is `tirupati_app`
 * (SEC-029), which could do this — but content maintenance is what this project already
 * reserves `MIGRATE_DATABASE_URL` for.
 */
const db = new PrismaClient({
  datasourceUrl: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL,
});

const replaceable = (url: string | null | undefined) =>
  !url || SEEDED.some((prefix) => url.startsWith(prefix));

/** Category slug → the three shots downloaded for it. */
const SHOTS = (slug: string) =>
  [1, 2, 3].map((n) => resolveUrl(`${PREFIX}${slug}-${n}.jpg`));

async function main() {
  let categories = 0;
  let slots = 0;
  let images = 0;

  const allCategories = await db.category.findMany({
    orderBy: { sortOrder: 'asc' },
    select: { id: true, slug: true, imageUrl: true },
  });

  // ── Category tiles: the homepage grid and /collections read these ──
  for (const category of allCategories) {
    if (!replaceable(category.imageUrl)) continue;

    await db.category.update({
      where: { id: category.id },
      data: { imageUrl: clear ? null : resolveUrl(`${PREFIX}${category.slug}-1.jpg`) },
    });
    categories += 1;
  }

  // ── Media slots ──
  const SLOT_FILES: Record<string, string | null> = {
    HERO_BANNER: 'hero.jpg',
    OFFER_STRIP: 'offer-strip.jpg',
    FEATURE_BANNER: 'feature.jpg',
    ABOUT_IMAGE: 'about.jpg',
    FOOTER_BG: 'footer.jpg',
    /**
     * Left empty deliberately. An invoice logo is a wordmark, not a photograph, so stock
     * jewellery here would be wrong rather than merely temporary. `lib/bills/logo.ts` fails
     * soft on an empty slot (SEC-025), so the PDF renders without it until a real logo is
     * uploaded.
     */
    BILL_LOGO: null,
    // The six category tiles mirror the categories, in sortOrder.
    ...Object.fromEntries(
      allCategories
        .slice(0, 6)
        .map((category, index) => [
          `CATEGORY_TILE_${index + 1}`,
          `${category.slug}-1.jpg`,
        ]),
    ),
  };

  for (const slot of await db.mediaSlot.findMany({
    select: { id: true, slotKey: true, imageUrl: true },
  })) {
    if (!(slot.slotKey in SLOT_FILES) || !replaceable(slot.imageUrl)) continue;

    const file = SLOT_FILES[slot.slotKey];
    await db.mediaSlot.update({
      where: { id: slot.id },
      data: { imageUrl: clear || !file ? null : resolveUrl(`${PREFIX}${file}`) },
    });
    slots += 1;
  }

  // ── Product galleries: three shots each, matched to the product's category ──
  const removed = await db.productImage.deleteMany({
    where: { OR: SEEDED.map((prefix) => ({ url: { startsWith: prefix } })) },
  });

  if (!clear) {
    for (const product of await db.product.findMany({
      select: {
        id: true,
        category: { select: { slug: true } },
        images: { select: { id: true } },
      },
    })) {
      // A product that already has a real photo keeps its own gallery.
      if (product.images.length > 0) continue;

      await db.productImage.createMany({
        data: SHOTS(product.category.slug).map((url, index) => ({
          productId: product.id,
          url,
          alt: `${product.category.slug} — preview photograph ${index + 1}`,
          sortOrder: index,
        })),
      });
      images += 3;
    }
  }

  console.log(
    clear
      ? `Cleared: ${categories} categories, ${slots} slots, ${removed.count} product images.`
      : `Set: ${categories} categories, ${slots} media slots, ${images} product images ` +
          `(removed ${removed.count} previously seeded rows first).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
