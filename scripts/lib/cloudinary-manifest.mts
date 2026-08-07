/**
 * The record of which preview photos live in Cloudinary.
 *
 * Written by `upload-photos.mts`, read by `seed-preview-images.mts`. It exists so a re-run
 * of either does not spend the upload quota again or point the database at files that were
 * cleaned up locally.
 *
 * ── Why it is not in `public/` ──
 * It was, briefly. It happened to be unreachable there only because Next refuses to serve
 * dotfiles — rename it without the leading dot and `public/` would publish a list of the
 * shop's Cloudinary asset ids. `public/` means "serve this to anyone"; ops metadata does not
 * belong there by accident.
 *
 * One definition, imported by both scripts, rather than the path written out twice — this
 * repository has spent a whole phase on what happens when the same decision exists in two
 * places (SEC-017 → SEC-028 → SEC-032).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const MANIFEST_PATH = 'scripts/cloudinary-manifest.json';

export interface ManifestEntry {
  publicId: string;
  url: string;
}

/** Keyed by the local basename without its extension, e.g. `rings-1`. */
export type Manifest = Record<string, ManifestEntry>;

export function readManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) return {};

  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch {
    // A corrupt manifest must not silently look like "nothing uploaded yet" — that would
    // re-upload everything and duplicate the assets in a real account.
    throw new Error(`${MANIFEST_PATH} exists but could not be parsed. Fix or delete it.`);
  }
}

export function writeManifest(manifest: Manifest): void {
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The Cloudinary URL for a local `/photos/x.jpg` path, if it was uploaded. */
export function remoteUrlFor(localUrl: string, manifest: Manifest): string | null {
  const name = localUrl.replace('/photos/', '').replace(/\.jpg$/, '');
  return manifest[name]?.url ?? null;
}
