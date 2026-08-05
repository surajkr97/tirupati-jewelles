/**
 * /collections — every category.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.1).
 *
 * ISR 600 (MASTER-SPEC §6): the catalogue changes rarely, and Phase 7's admin edits call
 * `revalidateTag('categories')` so a change appears without waiting out the window.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { Section } from '@/components/shell';
import { ImageFrame } from '@/components/ui';
import { listActiveCategories } from '@/lib/catalog/products';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Collections',
  description:
    'Browse rings, necklaces, earrings, bracelets, chains and bangles in 22K and 18K gold and 999 silver.',
};

export default async function CollectionsPage() {
  const categories = await listActiveCategories();

  return (
    <Section className="pt-8 md:pt-12">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-semibold tracking-tight text-ink md:text-h1-lg">
            Collections
          </h1>
          <p className="text-lead text-muted">
            Every piece hallmarked, priced from today&rsquo;s rate.
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6">
          {categories.map((category, index) => (
            <li key={category.id}>
              <Link
                href={`/collections/${category.slug}`}
                className="group flex flex-col gap-3 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                <ImageFrame
                  src={category.imageUrl}
                  alt={category.name}
                  ratio="1/1"
                  sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 380px"
                  // §6.5: priority only above the fold. The first row at 375px is two
                  // tiles; the rest lazy-load.
                  priority={index < 2}
                />
                <div className="flex flex-col gap-1">
                  <h2 className="text-body font-medium text-ink group-hover:underline">
                    {category.name}
                  </h2>
                  <p className="text-small text-muted">
                    {category._count.products}{' '}
                    {category._count.products === 1 ? 'piece' : 'pieces'}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
