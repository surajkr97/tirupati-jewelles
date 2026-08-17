/**
 * InstagramReels — the shop's recent reels on the homepage.
 * Created by Stage 7 (D-124).
 *
 * A server component, deliberately. The rail has no state: every tile is a link, the counts
 * are rendered once from data the server already holds, and the horizontal scroll is CSS.
 * Shipping this as a client component would send React state and an event handler to the
 * browser to reproduce what an `<a>` does natively.
 *
 * ── Tapping goes to Instagram, and does not try to play here ──
 *
 * An earlier draft opened the embed in a sheet. Measured in a real browser, Instagram's reel
 * embed contains NO `<video>` element at all — it renders a poster, a "Watch on Instagram"
 * overlay, and a click-through, before and after clicking. So the sheet cost 1.29MB and an
 * open `frame-src` to add a step in front of the thing the reader wanted. An `<a>` to the
 * permalink opens the Instagram app on a phone and a new tab on a desktop, where the reel
 * actually plays.
 *
 * That is also why the CSP is untouched by this feature — see `next.config.ts`.
 *
 * ── Layout ──
 *
 * One flex rail that changes behaviour rather than two layouts. On a phone it is a `snap-x`
 * scroller with 62%-wide tiles, so the second tile is visibly cut off at the right edge — the
 * peek IS the affordance that tells a thumb to swipe. From `md` the same rail becomes a
 * four-column grid and stops scrolling.
 */
import { Heart, MessageCircle, Play } from 'lucide-react';

import { ImageFrame } from '@/components/ui';
import { formatCount, type ReelCard } from '@/lib/social/instagram';
import { INSTAGRAM_HANDLE } from '@/lib/social/reels';

/**
 * The Instagram glyph, inline.
 *
 * `lucide-react` dropped its brand icons — there is no `Instagram` export in the installed
 * version, only 6068 non-brand ones — so this is drawn rather than imported.
 */
function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.5" strokeWidth={2.5} />
    </svg>
  );
}

export function InstagramReels({ reels }: { reels: readonly ReelCard[] }) {
  if (reels.length === 0) return null;

  return (
    <ul
      // The negative margin bleeds the rail to the screen edge on a phone, so the cut-off
      // tile reaches the actual edge rather than stopping at the gutter — which is what
      // makes it read as "there is more" instead of "this is clipped". The padding puts the
      // first tile back on the gutter line so it still aligns with the heading above it.
      className={[
        'flex snap-x snap-mandatory gap-4 overflow-x-auto',
        '-mx-[clamp(16px,-8.7623px+6.3493vw,40px)] px-[clamp(16px,-8.7623px+6.3493vw,40px)]',
        'md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0',
      ].join(' ')}
      aria-label={`Recent reels from @${INSTAGRAM_HANDLE}`}
    >
      {reels.map((reel) => (
        <li key={reel.id} className="w-[62%] shrink-0 snap-start md:w-full">
          <a
            href={reel.permalink}
            target="_blank"
            // `noopener` is the one that matters: without it the opened tab gets a handle on
            // this window through `window.opener` and can navigate it somewhere else.
            rel="noopener noreferrer"
            className={[
              'group relative block overflow-hidden rounded-card',
              'transition-transform duration-base ease-standard',
              'hover:-translate-y-1 active:scale-[0.98]',
              'focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none',
            ].join(' ')}
          >
            <ImageFrame
              src={reel.cover}
              alt=""
              ratio="9/16"
              // Phone: a 62%-wide tile on a ~390px screen. Desktop: a quarter of the 1200px
              // container. Without this every tile downloads at full width.
              sizes="(max-width: 767px) 62vw, 300px"
              // No `priority`: §6.5 reserves it for above-the-fold images, and this section
              // sits below the rate card and the product grid.
            />

            {/* A scrim, so the play mark and the counts stay legible whatever the cover
                happens to be — these are phone-shot videos and some are bright at the
                centre and at the bottom. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-linear-to-t from-ink/70 via-transparent to-ink/25"
            />

            <span
              aria-hidden="true"
              className={[
                'absolute inset-0 grid place-items-center',
                'transition-transform duration-base ease-standard group-hover:scale-110',
              ].join(' ')}
            >
              <span className="grid size-12 place-items-center rounded-pill bg-cream/90 shadow-lift">
                {/* Nudged right by a hair: a triangle's optical centre sits left of its
                    bounding box, so a centred play glyph reads as off-centre. */}
                <Play className="ml-[2px] size-icon fill-ink text-ink" />
              </span>
            </span>

            <span
              aria-hidden="true"
              className="absolute top-0 right-0 p-4 text-cream drop-shadow-sm"
            >
              <InstagramGlyph className="size-icon-sm" />
            </span>

            {/*
              The counts.

              `aria-hidden` with a real sentence in the link's own `aria-label` below: read
              out as markup this is "heart 72 speech-bubble 3", which is noise. The label
              says it in words instead, once.

              Hidden entirely when the counts are unknown — the checked-in fallback set has
              no counts and rendering "0 likes" would be inventing data.
            */}
            {(reel.likes !== null || reel.comments !== null) && (
              <span
                aria-hidden="true"
                className="absolute right-0 bottom-0 left-0 flex items-center gap-4 p-4 text-caption font-medium text-cream"
              >
                {reel.likes !== null && (
                  <span className="flex items-center gap-1">
                    <Heart className="size-icon-sm fill-cream" />
                    <span className="num">{formatCount(reel.likes)}</span>
                  </span>
                )}
                {reel.comments !== null && (
                  <span className="flex items-center gap-1">
                    <MessageCircle className="size-icon-sm" />
                    <span className="num">{formatCount(reel.comments)}</span>
                  </span>
                )}
              </span>
            )}

            {/* The whole tile is one link, so it needs one accessible name that covers the
                picture, the counts and where it goes. */}
            <span className="sr-only">
              {reel.alt}
              {reel.likes !== null ? `. ${formatCount(reel.likes)} likes` : ''}
              {reel.comments !== null ? `, ${formatCount(reel.comments)} comments` : ''}.
              Opens on Instagram.
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
