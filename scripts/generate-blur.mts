/**
 * Generate the blur placeholders §9.2 asks for ("blur placeholders everywhere").
 *
 *   npx tsx scripts/generate-blur.mts [--force]
 *
 * ── What a placeholder is here ──
 * A 16px-wide JPEG, base64 in a `data:` URI, handed to `next/image` as `blurDataURL`. Next
 * paints it scaled-up and blurred until the real image decodes, so a slow connection sees the
 * photograph's colours rather than an empty tint. Roughly 300–600 bytes each, inlined into the
 * HTML — which is why the source must be *tiny* rather than merely small: a 2 kB placeholder on
 * a 24-image page is 48 kB of HTML that blocks nothing but pays for nothing either.
 *
 * ── Why they are stored, not derived ──
 * Deriving one at render time means fetching the full image on the server for every page
 * render, which is the opposite of the optimisation. So it is computed once, here, and lives
 * in a nullable column beside the URL.
 *
 * ── Why no image library ──
 * Cloudinary already resizes on delivery, so the 16px rendition is a URL parameter
 * (`w_16,q_30`) rather than a local decode. That keeps this script dependency-free and means
 * the placeholder is generated from exactly the asset that will be served.
 *
 * Local `/photos/…` paths and any other non-Cloudinary URL are skipped rather than guessed at —
 * see the note where it happens.
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

config({ path: '.env', quiet: true });

const force = process.argv.includes('--force');

const db = new PrismaClient({
  datasourceUrl: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL,
});

/**
 * Rewrite a Cloudinary delivery URL to a 16px-wide, heavily compressed rendition.
 *
 * The transformation segment sits between `/upload/` and the public id, and the stored URLs
 * already carry one (`f_auto,q_auto`), so it is replaced rather than appended — stacking two
 * segments produces a 404 rather than a smaller image.
 */
function tinyVariant(url: string): string | null {
  const match =
    /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?:[^/]*\/)?(.+)$/.exec(
      url,
    );
  if (!match) return null;

  // `f_jpg` explicitly: the data URI has to declare a mime type, and `f_auto` would hand back
  // AVIF or WebP depending on what the SCRIPT's fetch advertises — which is not what the
  // browser will be told.
  return `${match[1]}c_fill,w_16,h_16,q_30,f_jpg/${match[2]}`;
}

async function blurFor(url: string): Promise<string | null> {
  const tiny = tinyVariant(url);
  if (!tiny) return null;

  const response = await fetch(tiny);
  if (!response.ok) return null;

  const bytes = Buffer.from(await response.arrayBuffer());
  // Guard against a CDN error page arriving as a 200: a JPEG starts FF D8.
  if (bytes.length < 40 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

/** Cache by URL — the 25 products share 18 photos between them. */
const cache = new Map<string, string | null>();

async function blurCached(url: string): Promise<string | null> {
  if (!cache.has(url)) cache.set(url, await blurFor(url));
  return cache.get(url) ?? null;
}

async function main() {
  let done = 0;
  let skipped = 0;
  let bytes = 0;

  const note = (blur: string | null) => {
    if (blur) {
      done += 1;
      bytes += blur.length;
    } else {
      /**
       * Not a failure. A local `/photos/…` path has no CDN to resize it, and inventing a
       * placeholder from a colour guess would be worse than none — `ImageFrame` already
       * renders a branded tint when `blurDataURL` is absent (§2.2).
       */
      skipped += 1;
    }
  };

  for (const image of await db.productImage.findMany({
    where: force ? {} : { blurDataUrl: null },
    select: { id: true, url: true },
  })) {
    const blur = await blurCached(image.url);
    if (blur)
      await db.productImage.update({
        where: { id: image.id },
        data: { blurDataUrl: blur },
      });
    note(blur);
  }

  for (const category of await db.category.findMany({
    where: force ? {} : { blurDataUrl: null },
    select: { id: true, imageUrl: true },
  })) {
    if (!category.imageUrl) continue;
    const blur = await blurCached(category.imageUrl);
    if (blur)
      await db.category.update({
        where: { id: category.id },
        data: { blurDataUrl: blur },
      });
    note(blur);
  }

  for (const slot of await db.mediaSlot.findMany({
    where: force ? {} : { blurDataUrl: null },
    select: { id: true, imageUrl: true },
  })) {
    if (!slot.imageUrl) continue;
    const blur = await blurCached(slot.imageUrl);
    if (blur)
      await db.mediaSlot.update({ where: { id: slot.id }, data: { blurDataUrl: blur } });
    note(blur);
  }

  const average = done > 0 ? Math.round(bytes / done) : 0;
  console.log(
    `Generated ${done} placeholders (avg ${average} bytes), skipped ${skipped} ` +
      `(no CDN rendition available). ${cache.size} distinct images fetched.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
