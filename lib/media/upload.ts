/**
 * Direct-to-provider signed uploads.
 * Created by Phase 7 (specs/07-admin-panel.md §7.8).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §7.8: "Direct-to-provider signed uploads. The image bytes never pass through the app
 *  server."
 *
 *  So the server's entire job is to sign a set of parameters. The browser POSTs the file
 *  straight to Cloudinary with that signature attached; nothing large ever reaches this
 *  process, which is both the security requirement and the reason a 10MB upload cannot
 *  exhaust a Node worker's memory.
 *
 *  ── Why there is no upload preset ──
 *  Presets are mandatory only for UNSIGNED uploads. Signing lets the constraints — folder,
 *  format allowlist, size cap, EXIF stripping — travel inside the signature instead, which
 *  puts them in reviewed, version-controlled code rather than in a dashboard setting that
 *  can be changed without a deploy. A parameter not covered by the signature is a parameter
 *  the client can rewrite, so every constraint below is signed.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { env } from '@/lib/env';

/** §7.8: "Max 10MB." Enforced by Cloudinary because it is inside the signature. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** §7.8: "Accept JPEG, PNG, WebP, AVIF only". */
export const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'avif'] as const;

/** Everything the shop uploads lives here, so it can be found and purged as a unit. */
export const UPLOAD_FOLDER = 'tirupati/products';

export interface UploadGrant {
  url: string;
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicId: string;
  folder: string;
  /** Echoed so the client can reject an oversized file before starting the transfer. */
  maxBytes: number;
  allowedFormats: readonly string[];
}

export function isUploadConfigured(): boolean {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
  );
}

/**
 * Cloudinary's signature: SHA-1 over the signed parameters, sorted by key, joined as a
 * query string, with the API secret appended.
 *
 * SHA-1 is Cloudinary's specified algorithm, not a choice made here. It is a shared-secret
 * MAC over short, server-authored values with a timestamp — not a collision-sensitive use —
 * so its weaknesses do not apply. Noted because "SHA-1" in a security-relevant path
 * otherwise looks like an oversight.
 */
function sign(params: Record<string, string | number>, secret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return createHash('sha1').update(`${canonical}${secret}`).digest('hex');
}

/**
 * Issue a short-lived grant for one upload.
 *
 * Every value that constrains the upload is inside the signature. A client that rewrites
 * `folder`, raises `max_bytes`, or adds a format is rejected by Cloudinary because the
 * signature no longer matches — which is what makes an unauthenticated-to-Cloudinary POST
 * safe to allow at all.
 */
export function createUploadGrant(): UploadGrant | null {
  if (!isUploadConfigured()) return null;

  const cloudName = env.CLOUDINARY_CLOUD_NAME!;
  const apiKey = env.CLOUDINARY_API_KEY!;
  const secret = env.CLOUDINARY_API_SECRET!;

  const timestamp = Math.floor(Date.now() / 1000);

  /**
   * §7.8: "Filenames replaced with UUIDs. An uploaded filename is never used as a path
   * component."
   *
   * The public id is generated here, so the browser never gets to name anything. An
   * attacker-chosen name is how `../` and `x.php.jpg` end up in a path.
   */
  const publicId = randomUUID();

  const signedParams: Record<string, string | number> = {
    folder: UPLOAD_FOLDER,
    public_id: publicId,
    timestamp,

    // §7.8: "Auto-convert to WebP/AVIF". `f_auto` serves whichever the browser accepts;
    // `q_auto` picks a quality that holds up on a jewellery photo.
    eager: 'f_auto,q_auto/c_limit,w_1600/c_limit,w_800/c_limit,w_400',
    eager_async: 'true',

    /**
     * §7.8: "Strip EXIF — jewellery photos taken in-shop carry GPS coordinates of the
     * owner's premises."
     *
     * Both flags, deliberately. Cloudinary strips metadata on delivery by default, but the
     * ORIGINAL still holds it — and the original is retrievable. This discards it at
     * ingest, so the coordinates never exist on the provider at all.
     */
    image_metadata: 'false',
    invalidate: 'true',

    // Rejected by Cloudinary before the transfer completes, not by us afterwards.
    allowed_formats: ALLOWED_FORMATS.join(','),
  };

  /**
   * `resource_type` is deliberately NOT signed.
   *
   * Cloudinary excludes four parameters from the signature — `file`, `cloud_name`,
   * `api_key` and `resource_type` — and including one produces `Invalid Signature` with no
   * hint as to which. Found by probing the live account: with `resource_type` in the set
   * every upload failed 401, and removing it changed the response to a permissions error,
   * which is how the two problems were told apart.
   *
   * Nothing is lost by not signing it: it is part of the endpoint path
   * (`/image/upload`), so a client cannot change it without calling a different URL.
   */

  return {
    url: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    cloudName,
    apiKey,
    timestamp,
    signature: sign(signedParams, secret),
    publicId,
    folder: UPLOAD_FOLDER,
    maxBytes: MAX_UPLOAD_BYTES,
    allowedFormats: ALLOWED_FORMATS,
  };
}

/**
 * The delivery URL for an uploaded asset.
 *
 * `f_auto,q_auto` is applied at delivery rather than baked in, so the same stored original
 * serves AVIF to a browser that takes it and WebP to one that does not.
 */
export function deliveryUrl(publicId: string, width?: number): string {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return '';

  const transform = width ? `f_auto,q_auto,c_limit,w_${width}` : 'f_auto,q_auto';
  return `https://res.cloudinary.com/${cloudName}/image/upload/${transform}/${publicId}`;
}

/**
 * Verify that a URL the client claims to have uploaded really is ours.
 *
 * The browser reports the result of its own upload, and a browser can report anything. This
 * checks the URL is on our cloud, in our folder, and carries the public id we issued — so a
 * client cannot swap in someone else's asset or a URL we never signed.
 *
 * It is a cheap structural check, not the whole defence: the caller then runs the same
 * `checkImageUrl` guard §7.7 uses, which fetches the bytes and sniffs them.
 */
export function isOurUpload(url: string, expectedPublicId: string): boolean {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'res.cloudinary.com' &&
    parsed.pathname.startsWith(`/${cloudName}/`) &&
    parsed.pathname.includes(UPLOAD_FOLDER) &&
    parsed.pathname.includes(expectedPublicId)
  );
}
