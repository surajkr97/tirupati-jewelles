/**
 * The Instagram reels featured on the homepage.
 *
 * ── Why this is a checked-in list and not a live feed ──
 *
 * Reading the account automatically needs the Instagram Graph API, which needs a Business
 * account, a Meta app and an access token that expires. The public profile page is no
 * substitute: it serves a ~600KB JavaScript shell behind a login wall with zero post data in
 * the HTML, so there is nothing for a server to parse. That was measured, not assumed.
 *
 * A typed list costs a commit per change and needs no token, no backend and no database.
 *
 * ── The covers are ours, and they are served from our own origin ──
 *
 * `public/reels/<code>.jpg` holds the poster frame for each reel — the shop's own content,
 * re-hosted deliberately. Pointing `<img>` at Instagram's CDN would mean opening `img-src`
 * to `*.cdninstagram.com` AND depending on signed URLs that rotate and 403 without warning.
 * Self-hosting keeps `img-src` untouched and lets `next/image` serve AVIF at the size each
 * breakpoint actually needs, instead of a fixed 500x889 JPEG.
 *
 * ── Adding or replacing a reel ──
 *
 * 1. Open the reel on Instagram and take the CODE out of `instagram.com/reel/CODE/`.
 * 2. Save its cover frame as `public/reels/CODE.jpg`, 9:16, ~500px wide is plenty.
 * 3. Add an entry below with `alt` describing what is IN the frame — it is the only
 *    description a screen-reader user gets, so "gold chain held up to camera" is useful
 *    and "Instagram reel" is not.
 *
 * Every code here was verified to resolve to this account by rendering its embed in a real
 * browser; a deliberately invalid code renders Instagram's "link may be broken" page, which
 * is how the check distinguishes a real shortcode from a typo.
 */

export interface Reel {
  /** The CODE in `instagram.com/reel/CODE/`. Also the cover filename. */
  code: string;
  /** What is visible in the cover frame. Never "Instagram reel" — describe the picture. */
  alt: string;
}

export const INSTAGRAM_HANDLE = '_tirupati_jewelers_';

export const INSTAGRAM_PROFILE_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

export const REELS: readonly Reel[] = [
  {
    code: 'DcGC0ANuE5h',
    alt: 'A fine gold chain held up to the camera with its hallmark tag still attached, the shop’s display cabinets behind',
  },
  {
    code: 'DcFUqp3QUsi',
    alt: 'A hand wearing seven gold rings of different designs, held up in front of the shop counter',
  },
  {
    code: 'DcDYa0_sQiy',
    alt: 'A bunch of gold chains and pendants held together on a pin, beside a small Indian flag',
  },
  {
    code: 'Db6-PHUoFCc',
    alt: 'A very fine gold chain held between two fingers to show its thickness, shop display behind',
  },
] as const;

/** The reel on Instagram — where the tile's "open on Instagram" link goes. */
export function reelUrl(code: string): string {
  return `https://www.instagram.com/reel/${code}/`;
}

/**
 * The embeddable player.
 *
 * `/embed/captioned` rather than `/embed`, because the plain variant drops the account name
 * and the caption — so a reel opened from our page would carry nothing identifying whose it
 * is. Requires `frame-src https://www.instagram.com` in the CSP (see next.config.ts).
 */
export function reelEmbedUrl(code: string): string {
  return `https://www.instagram.com/reel/${code}/embed/captioned`;
}

/** The self-hosted poster frame. */
export function reelCoverSrc(code: string): string {
  return `/reels/${code}.jpg`;
}
