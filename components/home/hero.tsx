/**
 * Homepage hero.
 * Created by the UI redesign, Stage 4A (brief §5); recomposed by Stage 6 (§5, §6).
 *
 * ── Stage 4 put the photograph BELOW the type on a phone. Stage 6 puts the type ON it ──
 *
 * The old composition was a wine field holding the headline, with the photograph as a
 * separate band underneath. It was chosen for a good reason — every character sat on flat
 * wine at 15.51:1 — but it made the image a block rather than the hero, and it made the
 * page open on the darkest surface in the design. §1 asks for the opposite: light, editorial,
 * photography-led.
 *
 * So the photograph is now the field at every width and the type sits over it, which is what
 * §5 asks for. The contrast is bought with a scrim rather than a flat colour, and the scrim
 * is measured rather than eyeballed: white over an ink scrim at 40% on a mid-tone photograph
 * is 6.17:1, at 55% it is 8.08:1. The gradient below reaches its strongest exactly where the
 * text sits and falls away to almost nothing over the jewellery, which is §5's "minimum
 * necessary overlay" — the picture stays a picture.
 *
 * ── Two grounds, because an empty slot is a real state ──
 *
 * `HERO_BANNER` can be unset (§7.6 lets the owner clear it). A hero that assumes a photograph
 * would render white text on a dark rectangle for a shop that has not uploaded one yet. With
 * no image the hero is simply a light editorial block — sand, ink type, no scrim — which is
 * the same design language without pretending there is a picture.
 *
 * ── The accent word is gone ──
 *
 * Stage 4 lifted one word in `rose` on wine at 4.01:1, which cleared AA for display type and
 * nothing else. Over a photograph that headroom does not exist, and §17 wants rose used as an
 * accent rather than as decoration. The sentence always read correctly without colour — the
 * Stage 4 header said so — so it now reads that way.
 */
import Link from 'next/link';

import { Container } from '@/components/shell/container';
import { HeroMedia } from '@/components/shell/hero-media';
import { buttonClasses } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

export interface HeroProps {
  imageUrl: string | null;
  imageAlt: string;
  blurDataURL?: string;
  /**
   * Optional looping background video from the HERO_BANNER slot (D-126).
   *
   * `HeroMedia` mounts it only after the poster has loaded and only when the visitor has not
   * asked for reduced motion, so an absent video is the ordinary case rather than a
   * degraded one.
   */
  videoUrl?: string;
  /** Owner-set copy from the HERO_BANNER MediaSlot; falls back to the brand line. */
  headline?: string | null;
  subtext?: string | null;
}

/**
 * The default headline, and the shape it is written in.
 *
 * "Every gram, accounted for." is the brand's own claim rather than a decorative line: this
 * shop's whole proposition is a published rate, an honest making charge and a hallmark. The
 * MediaSlot's `headline` overrides it, so the owner can change the campaign without a deploy
 * (§7.6) — but a null slot must still say something true, not "Welcome to our store".
 */
const DEFAULT_HEADLINE = 'Every gram, accounted for.';
const DEFAULT_SUBTEXT = 'Today’s rates, honest making charges, hallmarked pieces.';

export function Hero({
  imageUrl,
  imageAlt,
  blurDataURL,
  videoUrl,
  headline,
  subtext,
}: HeroProps) {
  const onPhoto = Boolean(imageUrl);

  return (
    <section
      /**
       * `-mt-header pt-header` pulls the hero up BEHIND the sticky header.
       *
       * Without it the header renders transparent over the page background instead of over
       * the hero — cream marks on cream, completely invisible, which is exactly what the
       * first render of Stage 4A produced. The header is `sticky`, so it stays in flow and
       * occupies its own band; the hero has to reach up under it.
       *
       * `.surface-wine` is kept only while there IS a photograph: it inverts the focus ring
       * to cream, and an ink ring over a dark scrim is invisible to a keyboard user (D-057).
       * On the light ground the default ink ring is correct, so it is not applied.
       */
      className={cn(
        'relative isolate -mt-header pt-header md:-mt-header-lg md:pt-header-lg',
        /**
         * The hero keeps the pre-D-121 type and spacing — see `.hero-scale` in globals.css
         * for why this one section opts out of the fluid scale (D-125). It affects nothing
         * outside this element: the tokens are re-declared here and inherited downwards.
         */
        'hero-scale',
        onPhoto ? 'surface-wine text-white' : 'bg-sand text-ink',
      )}
      aria-labelledby="hero-heading"
    >
      {onPhoto && (
        <>
          <HeroMedia
            src={imageUrl}
            alt={imageAlt}
            blurDataURL={blurDataURL}
            videoSrc={videoUrl}
            priority
            className="absolute inset-0 -z-10 size-full"
          />

          {/*
            The scrim, strongest where the words are and almost absent over the piece.
            Vertical on a phone because the type sits at the bottom of the field; horizontal
            from `md` because it sits at the left and the jewellery is to the right.
          */}
          <div
            aria-hidden="true"
            className={cn(
              'absolute inset-0 -z-10',
              'bg-linear-to-t from-ink/80 via-ink/40 to-ink/5',
              'md:bg-linear-to-r md:from-ink/75 md:via-ink/35 md:to-transparent',
            )}
          />

          {/*
            A second, short scrim under the header band.
            
            The gradient above is built for where the TYPE sits — the bottom on a phone, the
            left on a desktop — and by design it fades to nothing over the jewellery. The
            transparent header sits across the top of exactly that zone, so at 1440px the
            nav links were white over the bright red plate with only the mid-gradient behind
            them, and on a lighter photograph the wordmark would go with them.
            
            Scoped to roughly the header's own height and fading out immediately, so it
            darkens the strip the marks need and nothing else — §5's minimum overlay applied
            a second time rather than deepening the first.
          */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 -z-10 h-[136px] bg-linear-to-b from-ink/60 to-transparent"
          />
        </>
      )}

      <Container>
        {/*
          Bottom-aligned on a phone, centred from `md`.
          `svh`, not `vh`: mobile browser chrome makes `vh` taller than the visible viewport,
          which would push the rate card below the fold on exactly the devices §4.5 measures.
        */}
        {/*
          Trimmed from 62svh / 560px (D-126).

          The type inside is unchanged — D-125 pinned it back to its original size on purpose,
          and shrinking the headline again is exactly what this must not do. What comes off is
          empty field above and below the block, which is the part that was only ever there to
          make the hero tall.

          The floor is §4.5's fold criterion, not taste: `e2e/smoke.spec.ts` asserts the rate
          ticker's top sits under 667px at 375×667, so a hero that grows pushes the one thing
          most visitors came for off the screen. Cutting height moves that measurement the
          safe way, and the test still guards the direction that matters.
        */}
        <div
          className={cn(
            'flex min-h-[54svh] flex-col justify-end py-12',
            'md:min-h-[480px] md:max-w-[560px] md:justify-center md:py-16',
          )}
        >
          <h1
            id="hero-heading"
            className="font-display text-display font-medium tracking-tight text-balance md:text-h1-lg"
          >
            {headline?.trim() || DEFAULT_HEADLINE}
          </h1>

          {/* The one ornament, and it earns its place by separating the headline from the
              supporting line without a blank gap. */}
          <div aria-hidden="true" className="mt-6 flex items-center gap-2">
            <span className={cn('h-px w-16', onPhoto ? 'bg-white/60' : 'bg-rose')} />
            <span
              className={cn('size-1 rounded-pill', onPhoto ? 'bg-white/60' : 'bg-rose')}
            />
          </div>

          <p
            className={cn(
              'mt-6 max-w-2xs text-lead',
              onPhoto ? 'text-white/85' : 'text-muted',
            )}
          >
            {subtext?.trim() || DEFAULT_SUBTEXT}
          </p>

          {/* One CTA. The rates below are the other thing people come for, and they are
              already the next thing on the page — a second button here would compete with a
              section the user reaches by simply continuing to scroll. */}
          <Link
            href="/collections"
            className={cn(
              buttonClasses({
                variant: onPhoto ? 'onWine' : 'primary',
                size: 'md',
              }),
              'mt-8 w-fit',
              /**
               * The CTA's height, restored to what it was before D-121 (D-125).
               *
               * This one cannot come from `.hero-scale`. The button reads `h-control`, and
               * pinning that token would give the hero a 52px button on a phone — bigger
               * than it ever was, because before D-121 this button was `h-tap sm:h-control`
               * and measured 44px there. So the two-step form is restored explicitly.
               *
               * Written AFTER `buttonClasses(...)` on purpose: `cn` resolves the `h-*`
               * conflict in favour of the last one, so ordering is what makes this override
               * take effect rather than silently lose to the variant it is overriding.
               */
              'h-tap sm:h-control',
            )}
          >
            Explore the collection
          </Link>
        </div>
      </Container>
    </section>
  );
}
