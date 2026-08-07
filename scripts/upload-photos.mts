/**
 * Upload the local preview photos to Cloudinary and repoint the database at them.
 *
 *   npx tsx --import ./scripts/loaders/register-server-only.mjs scripts/upload-photos.mts [--limit N]
 *
 * ── Why this goes through `createUploadGrant()` ──
 * It imports the REAL signer from `lib/media/upload.ts` rather than mirroring its constants
 * the way `verify-upload.mts` has to. That makes this an end-to-end exercise of the §7.8
 * path against the live account: the folder, the UUID public id, the format allowlist, the
 * EXIF stripping and the eager transforms all come from production code, so a drift between
 * that code and Cloudinary's expectations shows up here as a failed upload.
 *
 * Phase 7 TEST recorded the upload cases as NOT PROVEN for the upload path (DEBT-022). This
 * does not close that — the hostile cases are `verify-upload.mts`'s job — but it does prove
 * the happy path carries real bytes end to end.
 *
 * ── What it does NOT do ──
 * It never deletes from Cloudinary. Removing assets from a real account is not something a
 * content script should do on its own; `--clear` on `seed-preview-images.mts` unlinks them
 * from the database and leaves the originals in place.
 *
 * A manifest is written to `scripts/cloudinary-manifest.json` so a re-run skips what already
 * uploaded rather than spending the quota twice — and so `seed-preview-images.mts` can point
 * the database at Cloudinary rather than at local files.
 *
 * It lives in `scripts/`, NOT in `public/`. It was briefly the latter, where it happened to
 * be unreachable only because Next refuses to serve dotfiles — rename it without the leading
 * dot and `public/` would publish a list of the shop's asset ids. `public/` means "serve
 * this"; ops metadata does not belong there by accident.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { config } from 'dotenv';

import {
  readManifest,
  writeManifest,
  remoteUrlFor,
  type Manifest,
} from './lib/cloudinary-manifest.mts';

config({ path: '.env', quiet: true });

// Dynamic, because `lib/env.ts` parses at import and tsx does not load `.env` on its own.
const { createUploadGrant, isOurUpload, deliveryUrl } =
  await import('../lib/media/upload');
const { PrismaClient } = await import('@prisma/client');

const DIR = 'public/photos';

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const manifest: Manifest = readManifest();

const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.jpg'))
  .sort();

let uploaded = 0;
let skipped = 0;

for (const file of files) {
  const name = file.replace(/\.jpg$/, '');

  if (manifest[name]) {
    skipped += 1;
    continue;
  }
  if (uploaded >= limit) break;

  const grant = createUploadGrant();
  if (!grant) throw new Error('Cloudinary is not configured — check .env');

  const bytes = readFileSync(join(DIR, file));

  /**
   * Exactly the request the browser makes in `components/admin/product-images.tsx`: the
   * signed parameters, the api key, the timestamp and the file. Nothing else is sent,
   * because anything not covered by the signature would be rejected.
   */
  const body = new FormData();
  body.append('file', new Blob([new Uint8Array(bytes)]), file);
  body.append('api_key', grant.apiKey);
  body.append('timestamp', String(grant.timestamp));
  body.append('signature', grant.signature);
  body.append('public_id', grant.publicId);
  body.append('folder', grant.folder);
  body.append('eager', 'f_auto,q_auto/c_limit,w_1600/c_limit,w_800/c_limit,w_400');
  body.append('eager_async', 'true');
  body.append('image_metadata', 'false');
  body.append('invalidate', 'true');
  body.append('allowed_formats', grant.allowedFormats.join(','));

  const response = await fetch(grant.url, { method: 'POST', body });
  const json = (await response.json()) as {
    secure_url?: string;
    public_id?: string;
    error?: { message: string };
  };

  if (!response.ok || !json.secure_url || !json.public_id) {
    console.error(`  ✗ ${name}: ${json.error?.message ?? response.status}`);
    continue;
  }

  // The structural check the admin action runs on what the browser reports back.
  if (!isOurUpload(json.secure_url, grant.publicId)) {
    console.error(`  ✗ ${name}: upload succeeded but isOurUpload() rejected the URL`);
    continue;
  }

  // `f_auto,q_auto` at delivery, so one stored original serves AVIF or WebP per browser.
  const url = deliveryUrl(json.public_id);

  manifest[name] = { publicId: json.public_id, url };
  writeManifest(manifest);

  console.log(`  ✓ ${name.padEnd(14)} ${url}`);
  uploaded += 1;
}

console.log(`\nUploaded ${uploaded}, already present ${skipped}, of ${files.length}.`);

// ── Repoint the database, but only at what actually uploaded ──
if (process.argv.includes('--wire')) {
  const db = new PrismaClient({
    datasourceUrl: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL,
  });

  const remote = (localUrl: string) => remoteUrlFor(localUrl, manifest);

  let moved = 0;

  for (const category of await db.category.findMany({
    select: { id: true, imageUrl: true },
  })) {
    const url = category.imageUrl?.startsWith('/photos/')
      ? remote(category.imageUrl)
      : null;
    if (!url) continue;

    await db.category.update({ where: { id: category.id }, data: { imageUrl: url } });
    moved += 1;
  }

  for (const slot of await db.mediaSlot.findMany({
    select: { id: true, imageUrl: true },
  })) {
    const url = slot.imageUrl?.startsWith('/photos/') ? remote(slot.imageUrl) : null;
    if (!url) continue;

    await db.mediaSlot.update({ where: { id: slot.id }, data: { imageUrl: url } });
    moved += 1;
  }

  for (const image of await db.productImage.findMany({
    where: { url: { startsWith: '/photos/' } },
    select: { id: true, url: true },
  })) {
    const url = remote(image.url);
    if (!url) continue;

    await db.productImage.update({ where: { id: image.id }, data: { url } });
    moved += 1;
  }

  console.log(`Repointed ${moved} database rows at Cloudinary.`);
  await db.$disconnect();
}
