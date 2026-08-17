/**
 * Homepage.
 * Created by Phase 1, built out by Phase 4 (specs/04-rates-ticker.md §4.5).
 * Recomposed by the UI redesign, Stage 4A (brief §4).
 *
 * ISR with a 300s window plus a client ticker island (MASTER-SPEC §6): the shell is
 * static and instant, only the rate widget is dynamic.
 *
 * ── The section order, and the one rule it must not break ──
 *
 *   hero → rates → disclaimer → new arrivals → collections → trust
 *
 * §4.5 fixes the ticker's position and gives the reason: "it is the reason people visit; it
 * does not go below a marketing banner." The hero above it is not a banner — it is the brand,
 * and it is one viewport — but the criterion is measured rather than argued with:
 * `e2e/smoke.spec.ts` asserts the ticker's top is under 667px at 375×667, and it is (638px).
 * If the hero ever grows, that test fails before anyone notices by eye.
 *
 * ── What replaced the old first screen ──
 *
 * The page used to open with a bare 16:9 photograph and a `sr-only` h1 (audit C-10). It said
 * nothing about who the shop is or why to trust it, and a first-time visitor met an
 * unlabelled image and a rate widget. The hero now carries the headline, so the h1 is real
 * and visible — and the fold criterion above is what keeps that from costing the ticker.
 */

import { Hero } from '@/components/home/hero';
import { InstagramReels } from '@/components/home/instagram-reels';
import { TrustBand } from '@/components/home/trust-band';
import { ProductCard, ProductGrid } from '@/components/product/product-card';
import { LiveRateCard } from '@/components/rates/live-rate-card';
import { Section } from '@/components/shell';
import { ImageFrame } from '@/components/ui';
import { EMPTY_FILTERS } from '@/lib/catalog/filters';
import { listProducts } from '@/lib/catalog/products';
import { db } from '@/lib/db';
import { getCurrentRates, getRateHistory, RATE_FACES } from '@/lib/rates';
import { getRecentReels } from '@/lib/social/instagram';
import { INSTAGRAM_PROFILE_URL } from '@/lib/social/reels';
import { serialiseRates } from '@/lib/rates-view';
import { canonical } from '@/lib/seo';
import { ogImageFrom, OG_HEIGHT, OG_WIDTH } from '@/lib/seo/og-image';
import { getTickerJitter } from '@/lib/settings';

import Link from 'next/link';

import type { Metadata } from 'next';

/**
 * The home page inherits its title and description from the root layout — it IS the site.
 *
 * What it needs of its own is two things. The CANONICAL, because `/` is reachable as
 * `/?utm_source=…` from every link the shop shares on WhatsApp and without this each of
 * those is a separate URL. And the SOCIAL CARD (§14): the root layout declared
 * `twitter.card: 'summary_large_image'` with no `og:image` behind it, so every one of those
 * WhatsApp links reserved a large preview and filled it with blank.
 *
 * `generateMetadata` rather than a static object — and it replaces that export rather than
 * sitting beside it, because Next allows one or the other and never both. Dynamic because the image lives in the
 * `HERO_BANNER` slot and the owner can change it from `/admin/media` without a deploy. The
 * page is already ISR at 300s and this query is the same one the page body runs, so it costs
 * a cached read rather than a round trip per share.
 *
 * Next merges this with the root layout's `openGraph`, so the title, description, locale and
 * `siteName` set there are untouched — only the images are added.
 */
export async function generateMetadata(): Promise<Metadata> {
  const hero = await db.mediaSlot.findUnique({
    where: { slotKey: 'HERO_BANNER' },
    select: { imageUrl: true, headline: true, isActive: true },
  });

  // A cleared or deactivated slot means no image, not a broken one.
  const image = hero?.isActive ? ogImageFrom(hero.imageUrl) : null;
  if (!image) return { ...canonical('/') };

  const images = [
    {
      url: image,
      width: OG_WIDTH,
      height: OG_HEIGHT,
      // The owner's own headline when they have set one; otherwise what the picture is.
      alt:
        hero?.headline?.trim() ||
        'Hallmarked gold and silver jewellery at Tirupati Jewelles',
    },
  ];

  return {
    ...canonical('/'),
    openGraph: { images },
    twitter: { images },
  };
}

export const revalidate = 300;

/** How many new arrivals the strip shows. Six fills the grid at every breakpoint. */
const NEW_ARRIVALS = 6;

async function loadTickerData() {
  const rates = await getCurrentRates();

  // Shared with /rates so the two cannot disagree about the shape (lib/rates-view.ts).
  const serialised = serialiseRates(rates);

  const histories = await Promise.all(
    RATE_FACES.map(async ({ key, metal, purity }) => {
      const points = await getRateHistory(metal, purity, 7);
      return [key, points.map((p) => p.rate.toString())] as const;
    }),
  );

  return { serialised, history: Object.fromEntries(histories) };
}

export default async function HomePage() {
  const [{ serialised, history }, tickerJitter, categories, hero, arrivals, reels] =
    await Promise.all([
      loadTickerData(),
      // The owner's switch. Fetched with everything else — it is a cached read, not a round trip.
      getTickerJitter(),
      db.category.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        take: 6,
        select: { id: true, name: true, slug: true, imageUrl: true, blurDataUrl: true },
      }),
      /**
       * §7.6: "every image on the site replaceable from the dashboard."
       *
       * `isActive` is honoured, so clearing or deactivating the slot returns the hero to its
       * wine ground rather than breaking the layout — `HeroMedia` treats a null poster as a
       * complete state, not an error.
       */
      db.mediaSlot.findUnique({
        where: { slotKey: 'HERO_BANNER' },
        select: {
          imageUrl: true,
          blurDataUrl: true,
          headline: true,
          subtext: true,
          isActive: true,
        },
      }),
      /**
       * New arrivals, through the SAME priced-listing path the collection pages use.
       *
       * `listProducts(null, …)` with the default sort is already `createdAt: 'desc'` across
       * every active category, so this needs no new query and — more importantly — no second
       * copy of the pricing call. Every price on this page comes from `priceProduct` against
       * the current rate snapshot, exactly as it does everywhere else.
       */
      listProducts(null, { ...EMPTY_FILTERS }),
      /**
       * Recent reels. Never rejects — it resolves to the checked-in set on any failure, so
       * it cannot take the homepage down with it and needs no `.catch()` here. See
       * `lib/social/instagram.ts`.
       */
      getRecentReels(),
    ]);

  const heroActive = hero?.isActive ? hero : null;
  const newArrivals = arrivals.products.slice(0, NEW_ARRIVALS);

  return (
    <>
      <Hero
        imageUrl={heroActive?.imageUrl ?? null}
        // Decorative unless the owner has given the slot a headline to describe it.
        imageAlt={heroActive?.headline ?? ''}
        blurDataURL={heroActive?.blurDataUrl ?? undefined}
        headline={heroActive?.headline}
        subtext={heroActive?.subtext}
      />

      {/*
        The rate card overlaps the hero, which is what the reference does — and here it is
        also load-bearing.

        §4.5 makes "the ticker sits above the fold at 375×667" an acceptance criterion, with
        a reason that is still true: it is what people open this site for. A full-height hero
        above it pushed the card to y=733, 66px past the fold, and `e2e/smoke.spec.ts` failed
        exactly as it should have.

        Deleting that criterion was the wrong fix. Pulling the card up over the photograph
        buys the space back, matches the reference composition, and gives the card the
        overlap that makes it read as the page's centrepiece rather than the next block down.
        Measured after: y=638, 29px inside the fold.
      */}
      <Section className="relative z-10 -mt-12 py-8 md:-mt-16 md:py-12">
        <LiveRateCard
          initialRates={serialised}
          history={history as Record<'gold22' | 'gold18' | 'silver999', string[]>}
          /* The owner's dashboard switch, resolved here rather than read from the
             environment inside the card — see `getTickerJitter`. */
          jitter={tickerJitter}
        />
      </Section>

      {newArrivals.length > 0 && (
        <Section
          display
          heading="New arrivals"
          seeAllHref="/collections"
          seeAllLabel="View all"
        >
          <ProductGrid>
            {newArrivals.map((product) => (
              // ProductGrid is a <ul>. Its children must be <li> — see the note there.
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ProductGrid>
        </Section>
      )}

      {/*
        ── Reels (Stage 7) ──

        After the product grid, not above it. The rate card and the pieces themselves are the
        commercial path; this is social proof and belongs behind them — putting it higher
        would push the live rate card, which is the reason most people open the site, further
        down a phone screen.

        `seeAllHref` is an external URL. `Section` renders it through `next/link`, which
        handles an absolute href by emitting a plain anchor, so no special case is needed.

        The link reads "View all", matching the "See all" / "View all" wording every other
        section on the site uses for the same affordance. It briefly carried the handle
        instead — that put `@_tirupati_jewelers_` in the top-right corner where every other
        section has a short action, and read as a stray label rather than as something to
        press. The handle is still one tap away, on the profile the link opens.

        The eyebrow is the word "Instagram" and NOT the handle, for a separate reason:
        `Section` styles every eyebrow `uppercase`, which rendered `@_tirupati_jewelers_` as
        `@_TIRUPATI_JEWELERS_` — a handle that does not exist, printed as though it did.
      */}
      <Section
        display
        heading="From our Instagram"
        eyebrow="Instagram"
        seeAllHref={INSTAGRAM_PROFILE_URL}
        seeAllLabel="View all"
      >
        <InstagramReels reels={reels} />
      </Section>

      {/*
        The trust band sits BETWEEN the two product sections rather than closing the page.

        As a full-bleed `sand` band it breaks the run of white sections in half, so the page
        alternates surface rather than presenting two grids back to back — and the four facts
        it carries (hallmarking, making charges, itemised pricing, a rate set each morning)
        land while somebody is still looking at pieces, which is when they matter.
      */}
      <TrustBand />
      {/*
        ── Collections (§6) ──

        Every category carries a real photograph — Stage 5F made `Category.imageUrl`
        settable and the shop has filled all six. The first tile is wider and squarer than
        the rest so the row has a subject instead of six identical squares.
      */}
      <Section display heading="Collections" seeAllHref="/collections">
        {/*
          Two wide tiles, then four narrow ones — varied sizes, but every tile in a row
          shares a ratio so the labels sit on one line. The first attempt mixed a 4/3 tile
          with 4/5 neighbours in the same row and their captions floated at three different
          heights, which is the failure mode §10's "intentional alignment" is about.
        */}
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-12 md:gap-6">
          {categories.map((category, index) => {
            const wide = index < 2;
            return (
              <li
                key={category.id}
                className={wide ? 'col-span-2 md:col-span-6' : 'md:col-span-3'}
              >
                <Link href={`/collections/${category.slug}`} className="group block">
                  <div className="overflow-hidden rounded-card">
                    <ImageFrame
                      src={category.imageUrl}
                      /* Decorative: the name is printed directly beneath, and a screen
                       reader announcing it twice helps nobody. */
                      alt=""
                      ratio={wide ? '3/2' : '4/5'}
                      sizes={
                        wide
                          ? '(max-width: 768px) 100vw, 50vw'
                          : '(max-width: 768px) 50vw, 25vw'
                      }
                      blurDataURL={category.blurDataUrl ?? undefined}
                      className="transition-transform duration-slow ease-standard group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  </div>
                  <p className="mt-2 text-body font-medium text-ink group-hover:text-rose-deep">
                    {category.name}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}
