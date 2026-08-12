/**
 * The Open Graph image, derived from the shop's own hero photograph.
 * Created by the UI redesign, Stage 6 (brief §14).
 *
 * ── What was there before ──
 *
 * `openGraph` in the root layout declared a type, a locale, a title and a description, and
 * **no image at all** — while `twitter.card` was `summary_large_image`. A large-image card
 * with no image is the worst of both: the platform reserves the space and renders nothing,
 * so every link the shop sends on WhatsApp shared as a blank rectangle.
 *
 * ── Why the hero, and why a transform rather than a new asset ──
 *
 * §14 asks for the real `HERO_BANNER`, no generated replacement. That image is already
 * uploaded, already validated by §7.7's guard, already served from Cloudinary with a blur
 * placeholder — so the only thing missing is the crop. Cloudinary does that in the URL, and
 * the URL is one the shop already owns.
 *
 * 1200×630 is the Open Graph reference size. `c_fill` with `g_auto` lets Cloudinary pick the
 * crop from the image's own content, which matters because the hero is composed for a tall
 * phone and a wide social card is a very different frame — §6's warning about assuming
 * `cover` gets the composition right applies here too.
 */

/** The Open Graph reference size. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * Only OUR Cloudinary delivery URLs are rewritten.
 *
 * `checkImageUrl` accepts several hosts (§7.7), so a hero could legitimately be served from
 * somewhere that has never heard of `c_fill`. Inserting a Cloudinary transform into one of
 * those would produce a 404 — a broken `og:image` is worse than an uncropped one — so
 * anything that does not match the delivery shape is returned untouched.
 */
const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload)\/(.*)$/;

/**
 * The hero URL, cropped to the Open Graph frame.
 *
 * Returns null when there is no hero, so the caller can leave `og:image` off entirely rather
 * than point it at nothing. A missing tag degrades to the platform's own preview; a tag
 * pointing at a 404 renders a broken image.
 */
export function ogImageFrom(heroUrl: string | null | undefined): string | null {
  const url = heroUrl?.trim();
  if (!url) return null;

  const match = CLOUDINARY_UPLOAD.exec(url);
  if (!match) return url;

  const [, base, rest] = match;

  /**
   * The existing transform chain is preserved, not replaced.
   *
   * The stored URL already carries `f_auto,q_auto` and sometimes an eager size from the
   * upload. Dropping those to write our own would change the format negotiation the rest of
   * the site relies on; prepending keeps them and adds the crop.
   *
   * `g_auto` — Cloudinary's content-aware gravity. The hero is composed for a tall frame
   * with the piece low in the image, and a centre crop to 1200×630 would cut it in half.
   */
  return `${base}/c_fill,g_auto,w_${OG_WIDTH},h_${OG_HEIGHT}/${rest}`;
}
