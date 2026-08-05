/**
 * Phase 7 SECURITY — signed uploads.
 * specs/07-admin-panel.md §7.8 and §7 SECURITY:
 *
 *   "Direct-to-provider signed uploads. The image bytes never pass through the app server."
 *   "Accept JPEG, PNG, WebP, AVIF only — checked by magic bytes."
 *   "Max 10MB. ... Filenames replaced with UUIDs. ... Strip EXIF."
 *   "Upload a `.php`/`.html` renamed to `.jpg` → rejected by magic-byte check."
 *   "Upload a 100MB file → rejected before buffering."
 *
 * The signature is the whole server-side contribution, so these assert what it covers. A
 * parameter outside the signature is a parameter the client can rewrite, and that is the
 * only way this design can go wrong.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_FORMATS,
  createUploadGrant,
  deliveryUrl,
  isOurUpload,
  isUploadConfigured,
  MAX_UPLOAD_BYTES,
  UPLOAD_FOLDER,
} from '@/lib/media/upload';

/**
 * Read from the environment rather than hardcoded.
 *
 * `vitest.setup.ts` fills in fake values only when `.env` has none, so on a machine with
 * real Cloudinary credentials these tests would otherwise compare against the wrong cloud.
 * What is under test is the signing algorithm and the URL shape — neither depends on which
 * account is configured, so reading the configured one makes the suite correct either way.
 */
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME!;
const SECRET = process.env.CLOUDINARY_API_SECRET!;

describe('upload configuration', () => {
  it('is configured in the test environment', () => {
    expect(isUploadConfigured()).toBe(true);
  });
});

describe('createUploadGrant', () => {
  it('issues a grant with everything the browser needs', () => {
    const grant = createUploadGrant();

    expect(grant).not.toBeNull();
    expect(grant!.url).toBe(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`);
    expect(grant!.maxBytes).toBe(MAX_UPLOAD_BYTES);
    expect(grant!.allowedFormats).toEqual(ALLOWED_FORMATS);
  });

  it('names the file itself — the client never chooses a path component', () => {
    const grant = createUploadGrant()!;

    /**
     * §7.8: "Filenames replaced with UUIDs. An uploaded filename is never used as a path
     * component." An attacker-chosen name is how `../` and `x.php.jpg` reach a path.
     */
    expect(grant.publicId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(grant.folder).toBe(UPLOAD_FOLDER);
  });

  it('issues a different public id every time', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createUploadGrant()!.publicId));

    // A reused id would let one upload overwrite another's asset.
    expect(ids.size).toBe(200);
  });

  it('the signature covers every constraint', () => {
    const grant = createUploadGrant()!;

    /**
     * Recomputed here from Cloudinary's documented rule — SHA-1 over the sorted parameters
     * with the secret appended — rather than by calling the implementation. If a constraint
     * were dropped from the signed set, this expected value would no longer match, which is
     * the whole point: a parameter outside the signature is one the client can rewrite.
     */
    const signed: Record<string, string | number> = {
      allowed_formats: ALLOWED_FORMATS.join(','),
      eager: 'f_auto,q_auto/c_limit,w_1600/c_limit,w_800/c_limit,w_400',
      eager_async: 'true',
      folder: UPLOAD_FOLDER,
      image_metadata: 'false',
      invalidate: 'true',
      public_id: grant.publicId,
      timestamp: grant.timestamp,
    };

    const canonical = Object.keys(signed)
      .sort()
      .map((key) => `${key}=${signed[key]}`)
      .join('&');
    const expected = createHash('sha1').update(`${canonical}${SECRET}`).digest('hex');

    expect(grant.signature).toBe(expected);
  });

  it('signs the format allowlist, so a client cannot widen it', () => {
    const grant = createUploadGrant()!;

    // §7.8's allowlist. Cloudinary refuses anything else because the list is signed —
    // rewriting the field breaks the signature rather than relaxing the rule.
    expect(grant.allowedFormats).toEqual(['jpg', 'jpeg', 'png', 'webp', 'avif']);
    expect(grant.allowedFormats).not.toContain('svg');
    expect(grant.allowedFormats).not.toContain('gif');
  });

  it('strips metadata at ingest, not merely on delivery', () => {
    const grant = createUploadGrant()!;

    /**
     * §7.8: "Strip EXIF — jewellery photos taken in-shop carry GPS coordinates of the
     * owner's premises."
     *
     * Cloudinary strips metadata on delivery by default, but the ORIGINAL keeps it and the
     * original is retrievable. `image_metadata: false` discards it at ingest, so the
     * coordinates never exist on the provider. Asserted through the signature, because
     * that is what makes the setting non-negotiable by the client.
     */
    const withMetadata: Record<string, string | number> = {
      allowed_formats: ALLOWED_FORMATS.join(','),
      eager: 'f_auto,q_auto/c_limit,w_1600/c_limit,w_800/c_limit,w_400',
      eager_async: 'true',
      folder: UPLOAD_FOLDER,
      image_metadata: 'true', // the client trying to keep EXIF
      invalidate: 'true',
      public_id: grant.publicId,
      timestamp: grant.timestamp,
    };
    const canonical = Object.keys(withMetadata)
      .sort()
      .map((key) => `${key}=${withMetadata[key]}`)
      .join('&');
    const tampered = createHash('sha1').update(`${canonical}${SECRET}`).digest('hex');

    expect(grant.signature).not.toBe(tampered);
  });

  it('caps the upload at 10MB — §7.8', () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('isOurUpload — the client reports its own result', () => {
  const publicId = '11111111-1111-4111-8111-111111111111';
  const good = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${UPLOAD_FOLDER}/${publicId}.jpg`;

  it('accepts a URL on our cloud, in our folder, with our public id', () => {
    expect(isOurUpload(good, publicId)).toBe(true);
  });

  it.each([
    [
      'another cloud account',
      `https://res.cloudinary.com/someone-else/image/upload/v1/${UPLOAD_FOLDER}/${publicId}.jpg`,
    ],
    [
      'another host entirely',
      `https://evil.example/${CLOUD}/${UPLOAD_FOLDER}/${publicId}.jpg`,
    ],
    [
      'outside our folder',
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/other/${publicId}.jpg`,
    ],
    [
      'a public id we did not issue',
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${UPLOAD_FOLDER}/22222222-2222-4222-8222-222222222222.jpg`,
    ],
    [
      'plain http',
      `http://res.cloudinary.com/${CLOUD}/image/upload/v1/${UPLOAD_FOLDER}/${publicId}.jpg`,
    ],
    ['not a URL', 'nonsense'],
  ])('rejects %s', (_name, url) => {
    // The browser reports where its upload landed, and a browser can report anything.
    expect(isOurUpload(url, publicId)).toBe(false);
  });

  it('is a structural check, not the whole defence', () => {
    /**
     * A URL can satisfy every condition above and still not be an image — Cloudinary hosts
     * whatever was stored under that id. `confirmUpload` therefore runs `checkImageUrl`
     * afterwards, which fetches the bytes and sniffs the magic numbers.
     *
     * §7 SECURITY: "Upload a `.php`/`.html` renamed to `.jpg` → rejected by magic-byte
     * check." That rejection happens in `lib/media/fetch-image.ts`, which has its own
     * suite; this records why the cheap check alone is not enough.
     */
    expect(isOurUpload(good, publicId)).toBe(true);
  });
});

describe('deliveryUrl', () => {
  it('applies f_auto so the browser gets AVIF or WebP', () => {
    // §7.8: "Auto-convert to WebP/AVIF." Applied at delivery rather than baked in, so one
    // stored original serves whichever format the browser accepts.
    expect(deliveryUrl('abc')).toBe(
      `https://res.cloudinary.com/${CLOUD}/image/upload/f_auto,q_auto/abc`,
    );
  });

  it('produces the three sizes §7.8 asks for', () => {
    for (const width of [400, 800, 1600]) {
      expect(deliveryUrl('abc', width)).toContain(`c_limit,w_${width}`);
    }
  });

  it('is on a host the SSRF allowlist already permits', () => {
    // `ALLOWED_IMAGE_HOSTS` contains res.cloudinary.com, so an uploaded URL passes the
    // §7.7 guard on the callback without widening anything.
    expect(new URL(deliveryUrl('abc')).hostname).toBe('res.cloudinary.com');
  });
});
