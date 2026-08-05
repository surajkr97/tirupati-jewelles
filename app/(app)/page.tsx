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
import { Card, ImageFrame } from '@/components/ui';
import { db } from '@/lib/db';
import { getCurrentRates, getRateHistory, RATE_FACES } from '@/lib/rates';

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
  const [{ serialised, history }, categories] = await Promise.all([
    loadTickerData(),
    db.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      take: 6,
      select: { id: true, name: true, slug: true, imageUrl: true },
    }),
  ]);

  return (
    <>
      {/* Hero. The MediaSlot lookup arrives in Phase 7; until then ImageFrame renders a
          branded placeholder so an empty slot looks deliberate (§2.2). */}
      <Section className="pt-6 pb-0 md:pt-8">
        <ImageFrame src={null} alt="" ratio="16/9" priority />
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
                <ImageFrame src={category.imageUrl} alt={category.name} ratio="1/1" />
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
          {/* A link, not a button — it navigates. Styled to match the accent button
              rather than adding a Radix Slot dependency for one call site. */}
          <Link
            href="/calculator"
            className="inline-flex h-control items-center justify-center rounded-pill bg-taupe-deep px-6 text-body font-semibold text-white transition-transform duration-fast ease-standard active:scale-[0.98]"
          >
            Open the calculator
          </Link>
        </Card>
      </Section>
    </>
  );
}
