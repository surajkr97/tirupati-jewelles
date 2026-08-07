/**
 * Download real jewellery photography into `public/photos/` for local preview.
 *
 * Source: Pexels (https://www.pexels.com), free to use under the Pexels licence.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  THESE ARE STOCK PHOTOS OF SOMEBODY ELSE'S JEWELLERY. THEY MUST NOT SHIP.
 *
 *  They exist so the storefront can be judged with real content in it — how a gold tile
 *  reads against the cream background, whether the type still holds over a photograph,
 *  what the gallery feels like on a phone. That is a design question you cannot answer
 *  against empty frames.
 *
 *  Putting them in front of customers is a different matter: this is a real shop with real
 *  prices, and a product page showing a piece the shop does not sell misrepresents the
 *  product. Replace every one with the owner's own photography before launch — §9.8's
 *  "Real data seeded: actual products, real images, real rates" is exactly this item.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the files are downloaded rather than hot-linked ──
 * `ALLOWED_IMAGE_HOSTS` drives `images.remotePatterns`, the CSP's `img-src` AND Phase 7
 * §7.7's SSRF allowlist. Pointing the catalogue at `images.pexels.com` would mean widening
 * all three for preview content. Local files under `public/` are same-origin, so `'self'`
 * already covers them and none of those controls has to move.
 *
 * Usage:  node scripts/fetch-photos.mjs
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/photos';
mkdirSync(OUT, { recursive: true });

/**
 * Pexels serves a cropped, compressed rendition straight from the CDN, so each file arrives
 * at the aspect ratio the slot needs and no local processing is required.
 */
const url = (id, ext, w, h) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.${ext}` +
  `?auto=compress&cs=tinysrgb&fit=crop&w=${w}&h=${h}`;

const SQUARE = [1200, 1200];

/** Curated by hand from Pexels search results — chosen for Indian retail jewellery. */
const PHOTOS = [
  // ── Category tiles and product galleries (1:1) ──
  ['rings-1', 13524236, 'jpeg', ...SQUARE, 'Gold and diamond rings on glass'],
  ['rings-2', 30206324, 'jpeg', ...SQUARE, 'Gold wedding rings on marble'],
  ['rings-3', 21928764, 'jpeg', ...SQUARE, 'Rings on a white surface'],

  ['necklaces-1', 19564918, 'jpeg', ...SQUARE, 'Gold necklace on white silk'],
  ['necklaces-2', 4155254, 'jpeg', ...SQUARE, 'Gold jewellery on a wooden tray'],
  ['necklaces-3', 7679654, 'jpeg', ...SQUARE, 'Necklaces on a display stand'],

  ['earrings-1', 37601639, 'jpeg', ...SQUARE, 'Gold jhumka earring'],
  ['earrings-2', 34365842, 'jpeg', ...SQUARE, 'Assorted gold earrings in a box'],
  ['earrings-3', 12168883, 'jpeg', ...SQUARE, 'Gold drop earrings on a stand'],

  ['bracelets-1', 38827895, 'jpeg', ...SQUARE, 'Three gold bracelets'],
  ['bracelets-2', 20493839, 'jpeg', ...SQUARE, 'Gold bracelets with emerald accents'],
  ['bracelets-3', 16853521, 'jpeg', ...SQUARE, 'Gold bracelet with ruby accents'],

  ['chains-1', 7679824, 'jpeg', ...SQUARE, 'Gold chains on a display rack'],
  ['chains-2', 14355033, 'jpeg', ...SQUARE, 'Layered gold chains'],
  ['chains-3', 30985153, 'jpeg', ...SQUARE, 'Layered gold necklaces, worn'],

  ['bangles-1', 37485307, 'jpeg', ...SQUARE, 'Intricate gold bangles'],
  ['bangles-2', 37485309, 'jpeg', ...SQUARE, 'Ornate gold bangles with gemstones'],
  ['bangles-3', 32989026, 'jpeg', ...SQUARE, 'Gold bangles on satin'],

  // ── Wide banners, at each slot's recommended ratio ──
  ['hero', 29038003, 'jpeg', 1600, 900, 'Traditional Indian wedding jewellery'],
  ['offer-strip', 32780784, 'jpeg', 1200, 400, 'Gold pendant on a saree'],
  ['feature', 10944923, 'jpeg', 1200, 600, 'A full gold jewellery set, worn'],
  ['about', 8887000, 'jpeg', 1200, 800, 'Gold bangles being shown at a counter'],
  ['footer', 37485309, 'jpeg', 1600, 400, 'Ornate gold bangles'],
];

let ok = 0;
const failed = [];

for (const [name, id, ext, w, h, description] of PHOTOS) {
  const file = join(OUT, `${name}.jpg`);

  if (existsSync(file)) {
    ok += 1;
    continue;
  }

  try {
    const response = await fetch(url(id, ext, w, h));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    // A CDN error page is a 200 with HTML in it; a real JPEG starts with FF D8.
    if (bytes.length < 5_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error(`not a JPEG (${bytes.length} bytes)`);
    }

    writeFileSync(file, bytes);
    console.log(
      `  ${name.padEnd(14)} ${String(bytes.length).padStart(7)}b  ${description}`,
    );
    ok += 1;
  } catch (err) {
    failed.push(`${name} (pexels ${id}): ${err.message}`);
  }
}

console.log(`\n${ok}/${PHOTOS.length} photos in ${OUT}/`);
if (failed.length > 0) {
  console.log('Failed:');
  for (const line of failed) console.log(`  ${line}`);
  process.exitCode = 1;
}
