/**
 * Homepage.
 * Created by Phase 1, built out by Phase 4 (specs/04-rates-ticker.md §4.5).
 *
 * ISR with a 300s window plus a client ticker island (MASTER-SPEC §6): the shell is
 * static and instant, only the rate widget is dynamic.
 *
 * Section order is fixed by §4.5, and the ticker's position is not cosmetic — "it is the
 * reason people visit; it does not go below a marketing banner."
 */

import Link from 'next/link';

import { RateTicker, type SerialisedRates } from '@/components/rates/rate-ticker';
import { Section } from '@/components/shell';
import { buttonClasses, Card, ImageFrame } from '@/components/ui';
import { db } from '@/lib/db';
import { getCurrentRates, getRateHistory, RATE_FACES } from '@/lib/rates';
import { canonical } from '@/lib/seo';

import type { Metadata } from 'next';

/**
 * The home page inherits its title and description from the root layout — it IS the site.
 * What it needs of its own is the canonical: `/` is reachable as `/?utm_source=…` from every
 * link the shop shares on WhatsApp, and without this each of those is a separate URL.
 */
export const metadata: Metadata = {
  ...canonical('/'),
};

export const revalidate = 300;

async function loadTickerData() {
  const rates = await getCurrentRates();

  const serialised = Object.fromEntries(
    RATE_FACES.map(({ key, unit }) => {
      const face = rates[key];
      return [
        key,
        {
          perGram: face.perGram.toString(),
          display: face.display.toString(),
          change: face.change.toString(),
          effectiveAt: face.effectiveAt,
          unit,
        },
      ];
    }),
  ) as unknown as SerialisedRates;

  const histories = await Promise.all(
    RATE_FACES.map(async ({ key, metal, purity }) => {
      const points = await getRateHistory(metal, purity, 7);
      return [key, points.map((p) => p.rate.toString())] as const;
    }),
  );

  return { serialised, history: Object.fromEntries(histories) };
}

export default async function HomePage() {
  const [{ serialised, history }, categories, hero] = await Promise.all([
    loadTickerData(),
    db.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      take: 6,
      select: { id: true, name: true, slug: true, imageUrl: true, blurDataUrl: true },
    }),
    /**
     * §7.6: "every image on the site replaceable from the dashboard."
     *
     * This lookup was owed by Phase 7 and never landed — the frame below was left hardcoded
     * to `null` with a comment saying the MediaSlot lookup "arrives in Phase 7". It did not,
     * so the admin could set HERO_BANNER and nothing changed. Wired here.
     *
     * `isActive` is honoured, so clearing or deactivating the slot returns the frame to the
     * branded empty state §2.2 requires rather than breaking the layout.
     */
    db.mediaSlot.findUnique({
      where: { slotKey: 'HERO_BANNER' },
      select: { imageUrl: true, blurDataUrl: true, headline: true, isActive: true },
    }),
  ]);

  return (
    <>
      {/*
        The homepage had NO `h1` at all (§9.7). It opens with a hero image and the ticker, so
        there was never a headline to be one — and a screen-reader user landing here got a
        document with no title above `h2`, which is the first thing "navigate by heading"
        lands on.

        Visually hidden rather than shown, because §4.5 makes "the ticker is above the fold at
        375px" an acceptance criterion that Phase 4 measured; a visible headline would push it
        down to satisfy a different criterion. `sr-only` gives the document its spine without
        moving a pixel.
      */}
      <h1 className="sr-only">Tirupati Jewelles — today’s gold and silver rates</h1>

      {/* Hero — MediaSlot HERO_BANNER, or a branded placeholder while it is empty (§2.2). */}
      <Section className="pt-6 pb-0 md:pt-8">
        <ImageFrame
          src={hero?.isActive ? hero.imageUrl : null}
          // Decorative unless the owner has given the slot a headline to describe it.
          alt={hero?.headline ?? ''}
          ratio="16/9"
          sizes="(max-width: 768px) 100vw, 1200px"
          blurDataURL={hero?.blurDataUrl ?? undefined}
          priority
        />
      </Section>

      {/* Above the fold at 375px — §4.5. */}
      <Section className="py-8 md:py-12">
        <RateTicker
          initialRates={serialised}
          history={history as Record<'gold22' | 'gold18' | 'silver999', string[]>}
        />
      </Section>

      <Section eyebrow="Browse" heading="Collections" seeAllHref="/collections">
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {categories.map((category) => (
            <li key={category.id}>
              <Link href={`/collections/${category.slug}`} className="block">
                <ImageFrame
                  src={category.imageUrl}
                  alt={category.name}
                  ratio="1/1"
                  blurDataURL={category.blurDataUrl ?? undefined}
                />
                <p className="mt-2 text-body font-medium text-ink">{category.name}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <Card className="flex flex-col items-start gap-4">
          <h2 className="text-h2 font-semibold text-ink">Price several pieces at once</h2>
          <p className="text-body text-muted">
            Add each item&rsquo;s weight and making charge to get one total, GST included.
          </p>
          {/* A link, not a button — it navigates, so it must be an anchor. It takes the
              Button's own classes rather than a copy of them (UI_REDESIGN_DEBT-003). */}
          <Link href="/calculator" className={buttonClasses({ variant: 'accent' })}>
            Open the calculator
          </Link>
        </Card>
      </Section>
    </>
  );
}
