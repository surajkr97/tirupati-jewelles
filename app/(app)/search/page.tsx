/**
 * /search — full-text over the catalogue.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.4).
 *
 * Server-rendered from `?q=`, so a result set is a shareable URL and the back button
 * behaves. Results are cached in Redis for 300s by `lib/catalog/search.ts` — the matching
 * IDs only, never the prices, which are recomputed every render because a cached price is a
 * stale price.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { ProductCard, ProductGrid } from '@/components/product/product-card';
import { SearchBox } from '@/components/product/search-box';
import { Section } from '@/components/shell';
import { EmptyState } from '@/components/ui';
import { listActiveCategories } from '@/lib/catalog/products';
import { MIN_QUERY_LENGTH, searchProducts } from '@/lib/catalog/search';

/** Per-query and Redis-backed; there is nothing to prerender. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search the catalogue by name, description or category.',
  // A search results page has no standalone value to an index, and letting every
  // `?q=` combination be crawled is how a small site acquires thousands of thin pages.
  robots: { index: false, follow: true },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const raw = typeof params.q === 'string' ? params.q : '';

  const [{ products, query, tooShort }, categories] = await Promise.all([
    searchProducts(raw),
    listActiveCategories(),
  ]);

  return (
    <Section className="pt-8 md:pt-12">
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-h1 font-medium tracking-tight text-ink md:text-h1-lg">
          Search
        </h1>

        <SearchBox initialQuery={raw} />

        {tooShort ? (
          // §6.4: "Empty state suggesting popular categories." Shown before anything is
          // typed as well as for a one-character query — a blank screen under a search box
          // gives a visitor nothing to do.
          <EmptyState
            title={query.length === 0 ? 'What are you looking for?' : 'Keep typing'}
            description={
              query.length === 0
                ? 'Search by name, or start from a collection.'
                : `Enter at least ${MIN_QUERY_LENGTH} characters.`
            }
            action={<CategoryLinks categories={categories} />}
          />
        ) : products.length === 0 ? (
          <EmptyState
            title={`Nothing matches “${query}”`}
            description="Try a shorter word, or browse a collection instead."
            action={<CategoryLinks categories={categories} />}
          />
        ) : (
          <>
            <p className="text-small text-muted" aria-live="polite">
              {products.length} {products.length === 1 ? 'result' : 'results'} for &ldquo;
              {query}&rdquo;
            </p>
            <ProductGrid>
              {products.map((product, index) => (
                <li key={product.id}>
                  <ProductCard product={product} priority={index < 2} />
                </li>
              ))}
            </ProductGrid>
          </>
        )}
      </div>
    </Section>
  );
}

function CategoryLinks({
  categories,
}: {
  categories: { id: string; name: string; slug: string }[];
}) {
  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {categories.map((category) => (
        <li key={category.id}>
          <Link
            href={`/collections/${category.slug}`}
            className="inline-flex h-tap items-center rounded-pill bg-rose-tint px-4 text-small font-medium text-ink transition-colors duration-fast ease-standard hover:bg-rose/15"
          >
            {category.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
