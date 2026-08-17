/**
 * Reads the shop's own recent reels from the Instagram Graph API.
 * Created by Stage 7 (D-124).
 *
 * ── Why an API and not the profile page ──
 *
 * The public profile is a ~600KB JavaScript shell behind a login wall with no post data in
 * the HTML — measured with curl, not assumed. There is nothing to parse, so a live list of
 * reels with like counts has exactly one source: the official API.
 *
 * ── Which API, and why this one ──
 *
 * "Instagram API with Instagram Login" (Business Login), NOT the Facebook Login flow. The
 * difference is a Facebook Page: the Facebook Login variant requires the IG account to be
 * connected to one, and this shop does not need a Page to sell jewellery. Instagram Login
 * authenticates against the Instagram account directly and is the documented choice for a
 * single-account integration.
 *
 * The cost of that choice, stated because it shows up in the UI: `caption` and
 * `media_product_type` are Facebook-Login-only fields. So there is no caption, and reels
 * cannot be selected by `media_product_type === 'REELS'`. `media_type === 'VIDEO'` is the
 * available proxy and it is a good one here — every video this account posts is a reel.
 *
 * ── The token expires, and that is the interesting failure ──
 *
 * A long-lived Instagram token lasts 60 days and dies after 60 days of non-use. So the
 * realistic production failure is not "the API is down", it is "the token quietly went stale
 * two months after launch". Every path through this module therefore degrades to the
 * checked-in reels rather than throwing — the homepage must never 500 because a social
 * section could not refresh. This is the same rule Phase 9 §9.5 applied to the image CDN.
 */
import 'server-only';

import { env } from '@/lib/env';
import { REELS, reelCoverSrc, reelUrl, type Reel } from '@/lib/social/reels';

/** A reel as the rail renders it, whatever the source. */
export interface ReelCard {
  /** Stable key. The IG media id when live, the shortcode for the fallback set. */
  id: string;
  /** Where tapping the tile goes — the reel on Instagram. */
  permalink: string;
  /** Cover image, always same-origin. See `coverFor` below. */
  cover: string;
  /** Describes the picture, for screen readers. */
  alt: string;
  /** Null when unknown — the fallback set has no counts and must not invent them. */
  likes: number | null;
  comments: number | null;
}

/** Shape of one item in the Graph API's `/media` response. */
interface IgMedia {
  id: string;
  media_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
}

const GRAPH_VERSION = 'v21.0';

/** How long a fetched list is reused. */
const CACHE_SECONDS = 60 * 30;

/** How many tiles the rail shows. */
export const REEL_COUNT = 4;

/**
 * The cover, proxied through our own origin.
 *
 * Instagram serves thumbnails from per-request hostnames — `instagram.fdel93-3.fna.fbcdn.net`
 * one minute, a different shard the next — on signed URLs that expire. `next.config.ts`
 * builds `images.remotePatterns` from `ALLOWED_IMAGE_HOSTS` and its comment explicitly bans
 * wildcard hostnames, so there is no honest allowlist entry to write: the set of hosts is not
 * knowable in advance.
 *
 * `/api/social/reel-cover` fetches the image server-side and serves the bytes from this
 * origin, which sidesteps the whole question — `img-src 'self'` already covers it, and no CSP
 * directive and no image host had to be opened up for this feature.
 */
function coverFor(media: IgMedia): string | null {
  const remote = media.thumbnail_url ?? media.media_url;
  if (!remote) return null;
  return `/api/social/reel-cover?u=${encodeURIComponent(remote)}`;
}

/** The checked-in set, shaped like the live one. Counts are null — never faked. */
function fallbackCards(): ReelCard[] {
  return REELS.slice(0, REEL_COUNT).map((reel: Reel) => ({
    id: reel.code,
    permalink: reelUrl(reel.code),
    cover: reelCoverSrc(reel.code),
    alt: reel.alt,
    likes: null,
    comments: null,
  }));
}

/**
 * The shop's most recent reels, newest first.
 *
 * Never throws and never returns an empty array: any failure — no token, an expired token, a
 * network error, a malformed response — resolves to the checked-in set, so the caller has
 * nothing to handle and the homepage cannot break because of this section.
 */
export async function getRecentReels(): Promise<ReelCard[]> {
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  const userId = env.INSTAGRAM_USER_ID;
  if (!token || !userId) return fallbackCards();

  try {
    const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/${userId}/media`);
    url.searchParams.set(
      'fields',
      'id,media_type,permalink,thumbnail_url,media_url,like_count,comments_count,timestamp',
    );
    // Over-fetch: the endpoint returns every media type and the reels are filtered out of
    // it below, so asking for exactly REEL_COUNT would usually come back short.
    url.searchParams.set('limit', '24');
    url.searchParams.set('access_token', token);

    const response = await fetch(url, {
      // Next's data cache rather than a hand-rolled Redis entry: this is a plain GET whose
      // freshness is time-based, which is precisely what `revalidate` is for.
      next: { revalidate: CACHE_SECONDS, tags: ['instagram-reels'] },
    });

    if (!response.ok) return fallbackCards();

    const body = (await response.json()) as { data?: IgMedia[] };
    const cards = (body.data ?? [])
      // See the header: `media_product_type` is Facebook-Login-only, so VIDEO is the
      // available stand-in for "is a reel".
      .filter((m) => m.media_type === 'VIDEO')
      .map((media): ReelCard | null => {
        const cover = coverFor(media);
        if (!cover || !media.permalink) return null;
        return {
          id: media.id,
          permalink: media.permalink,
          cover,
          // The API gives no caption on this login flow, so the alt text has to be generic.
          // It still says what the thing IS, which is more than "image" would.
          alt: 'A reel from Tirupati Jewellers on Instagram',
          likes: typeof media.like_count === 'number' ? media.like_count : null,
          comments:
            typeof media.comments_count === 'number' ? media.comments_count : null,
        };
      })
      .filter((c): c is ReelCard => c !== null)
      .slice(0, REEL_COUNT);

    // A successful call that yields nothing usable is still a failure for the reader.
    return cards.length > 0 ? cards : fallbackCards();
  } catch {
    return fallbackCards();
  }
}

/**
 * `1.2k` rather than `1200`.
 *
 * Exported so the component does not carry its own copy and the unit test can pin the
 * boundaries — 999 stays exact, 1000 becomes `1k`, and nothing ever renders `NaN`.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.floor(n));
  if (n < 100_000) {
    const k = Math.floor(n / 100) / 10;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${Math.floor(n / 1000)}k`;
}
