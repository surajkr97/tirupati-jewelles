/**
 * Stage 6 — the social card points at a real, correctly cropped image, or at nothing.
 *
 * The failure this guards is quiet: `twitter.card` has been `summary_large_image` since
 * Phase 9 with no `og:image` behind it, so every link the shop sent on WhatsApp reserved a
 * large preview and filled it with blank. Nothing errors, nothing logs, and it is only
 * visible to whoever received the message.
 *
 * The other half is the crop. The hero is composed for a tall phone; an Open Graph card is
 * 1200×630. Handing the raw URL to a platform means it centre-crops a portrait composition
 * into a letterbox, which is exactly the mistake §6 warns about with `cover`.
 */
import { describe, expect, it } from 'vitest';

import { ogImageFrom, OG_HEIGHT, OG_WIDTH } from '@/lib/seo/og-image';

const CLOUDINARY =
  'https://res.cloudinary.com/daeqn8kwz/image/upload/f_auto,q_auto/tirupati/hero/banner.jpg';

describe('ogImageFrom', () => {
  it('crops a Cloudinary hero to the Open Graph frame', () => {
    const url = ogImageFrom(CLOUDINARY)!;

    expect(url).toContain(`w_${OG_WIDTH}`);
    expect(url).toContain(`h_${OG_HEIGHT}`);
    // Content-aware, because the piece sits low in a hero composed for a phone.
    expect(url).toContain('g_auto');
    expect(url).toContain('c_fill');
  });

  it('keeps the transforms the upload already carries', () => {
    // `f_auto,q_auto` is the format negotiation the rest of the site depends on. Replacing
    // the chain rather than prepending to it would silently change delivery.
    expect(ogImageFrom(CLOUDINARY)).toContain('f_auto,q_auto');
    expect(ogImageFrom(CLOUDINARY)).toContain('tirupati/hero/banner.jpg');
  });

  it('inserts the crop before the existing chain, not inside the path', () => {
    const url = ogImageFrom(CLOUDINARY)!;
    const upload = url.indexOf('/image/upload/');
    expect(url.indexOf('c_fill')).toBeGreaterThan(upload);
    expect(url.indexOf('c_fill')).toBeLessThan(url.indexOf('f_auto'));
  });

  it('leaves a non-Cloudinary host completely alone', () => {
    /**
     * `checkImageUrl` allows several hosts (§7.7). Inserting a Cloudinary transform into
     * one of those produces a 404, and a broken `og:image` is worse than an uncropped one —
     * the platform renders a broken-image card instead of falling back.
     */
    const other = 'https://images.example.com/hero.jpg';
    expect(ogImageFrom(other)).toBe(other);
  });

  it('returns null for no hero, so the tag is omitted rather than empty', () => {
    // A missing tag degrades to the platform's own preview. A tag pointing at nothing does
    // not.
    expect(ogImageFrom(null)).toBeNull();
    expect(ogImageFrom(undefined)).toBeNull();
    expect(ogImageFrom('')).toBeNull();
    expect(ogImageFrom('   ')).toBeNull();
  });
});
