/**
 * Homepage hero.
 * Created by the UI redesign, Stage 4A (brief §5).
 *
 * ── The composition, and why it is two different compositions ──
 *
 * The reference puts the headline over the top-left of a wine field with the jewellery
 * bleeding off the right edge, and the rate card overlapping the boundary below. That works
 * because the photograph is wide and the text has somewhere to sit.
 *
 * At 390px there is no "beside". Stacking the same arrangement would give a headline over a
 * photograph, which is the composition that forces either a scrim or a shrunken headline —
 * and brief §3 forbids solving contrast by dimming. So the phone gets a genuinely different
 * layout: the wine field holds the type alone, and the photograph sits beneath it as a band.
 * Every character of the headline is on flat wine at 15.51:1, at full size, at every width.
 *
 * From `md` the two share a row and the image takes the right half.
 *
 * ── The accent word ──
 *
 * One word in `rose` on `wine` measures 4.01:1 — it clears AA for large text and fails it
 * for body, which is exactly why `contrast.test.ts` asserts BOTH directions (D-057). It is
 * safe here because it is display type and nowhere else. It is also not the only signal:
 * the sentence reads correctly with no colour at all.
 */
import Link from 'next/link';

import { HeroMedia } from '@/components/shell/hero-media';
import { buttonClasses } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

export interface HeroProps {
  imageUrl: string | null;
  imageAlt: string;
  blurDataURL?: string;
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
 *
 * Split so one word can carry the accent. If the owner sets their own headline it renders
 * plain, because we cannot know which of their words is the one to lift.
 */
const DEFAULT_HEADLINE = { lead: 'Every gram,', accent: 'accounted', tail: 'for.' };
const DEFAULT_SUBTEXT = 'Today’s rates, honest making charges, hallmarked pieces.';

export function Hero({ imageUrl, imageAlt, blurDataURL, headline, subtext }: HeroProps) {
  const custom = headline?.trim();

  return (
    <section
      /**
       * `-mt-header pt-header` pulls the wine up BEHIND the sticky header.
       *
       * Without it the header renders transparent over the page background instead of over
       * the hero — cream marks on cream, completely invisible, which is exactly what the
       * first render of Stage 4A produced. The header is `sticky`, so it stays in flow and
       * occupies its own band; the hero has to reach up under it. The matching padding puts
       * the content back where it belongs.
       *
       * `.surface-wine` inverts the focus ring to cream — an ink ring is 1.05:1 here and a
       * keyboard user tabbing to the CTA would see nothing at all (D-057).
       */
      className="surface-wine relative -mt-header bg-wine pt-header text-cream md:-mt-header-lg md:pt-header-lg"
      aria-labelledby="hero-heading"
    >
      {/*
        Full-bleed grid, not a contained one: the photograph runs to the right edge of the
        viewport the way the reference does, rather than stopping at the 1200px column and
        leaving a strip of wine beside it. The TEXT is what stays aligned to the page — it is
        capped and pushed to the inner edge of its half, so it lines up with the sections
        below rather than drifting with the viewport.
      */}
      <div className="md:grid md:min-h-[560px] md:grid-cols-2 md:items-center">
        <div className="flex justify-end">
          <div className="flex w-full max-w-[600px] flex-col px-[20px] pt-12 pb-8 md:px-[40px] md:py-16">
            <h1
              id="hero-heading"
              className="font-display text-display font-medium tracking-tight text-balance md:text-h1-lg"
            >
              {custom ? (
                custom
              ) : (
                <>
                  {DEFAULT_HEADLINE.lead}
                  <br />
                  {/* Display size only. See the file header. */}
                  <span className="text-rose">{DEFAULT_HEADLINE.accent}</span>{' '}
                  {DEFAULT_HEADLINE.tail}
                </>
              )}
            </h1>

            {/* The reference's small rule and dot — the one ornament, and it earns its place
                  by separating the headline from the supporting line without a blank gap. */}
            <div aria-hidden="true" className="mt-6 flex items-center gap-2">
              <span className="h-px w-16 bg-gold" />
              <span className="size-1 rounded-pill bg-gold" />
            </div>

            {/* cream at 70% measures 7.99:1 on wine — set back, still body text (D-057). */}
            <p className="mt-6 max-w-2xs text-lead text-cream/70">
              {subtext?.trim() || DEFAULT_SUBTEXT}
            </p>

            {/* One CTA. The rates below are the other thing people come for, and they are
                  already the next thing on the page — a second button here would compete with
                  a section the user reaches by simply continuing to scroll. */}
            <Link
              href="/collections"
              className={cn(
                'mt-8 w-fit',
                buttonClasses({ variant: 'onWine', size: 'lg' }),
              )}
            >
              Explore the collection
            </Link>
          </div>
        </div>

        {/*
          Mobile: a band beneath the type, so the headline never sits on the photograph.
          Desktop: the right half of the row, taller, bleeding to the edge.

          16/10 on the phone rather than 4/3 — see the rate card's overlap in `page.tsx`.
          Together they are what keeps §4.5's above-the-fold criterion true.

          Fixed aspect ratios at both breakpoints — the box is reserved before the image
          arrives, so the rate card below it never jumps.
        */}
        <HeroMedia
          src={imageUrl}
          alt={imageAlt}
          blurDataURL={blurDataURL}
          priority
          className="aspect-[16/10] w-full md:aspect-auto md:h-full md:min-h-[560px]"
        />
      </div>
    </section>
  );
}
