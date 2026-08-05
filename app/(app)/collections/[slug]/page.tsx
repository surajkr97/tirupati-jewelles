/**
 * /collections/[slug] — the products in one category.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.1).
 *
 * ISR 600 with `generateStaticParams` over active categories (MASTER-SPEC §6).
 *
 * ── A note on the rendering mode ──
 * A filtered view is a different URL, and Next renders a route with `searchParams` on
 * demand rather than serving the prerendered shell. That is the correct trade for §6.1's
 * "filters live in the URL so a filtered view is shareable": the *unfiltered* page — the
 * one nearly everyone lands on — is still prerendered and instant, and a filtered one is a
 * deliberate act by someone already engaged.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { FilterSheet } from '@/components/product/filter-sheet';
import { ProductCard, ProductGrid } from '@/components/product/product-card';
import { Section } from '@/components/shell';
import { Button, EmptyState } from '@/components/ui';
import {
  filtersToQuery,
  hasActiveFilters,
  parseFilters,
  PAGE_SIZE,
} from '@/lib/catalog/filters';
import {
  activeCategorySlugs,
  getCategoryBySlug,
  listProducts,
} from '@/lib/catalog/products';

export const revalidate = 600;

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** §6.1: prerender a page per active category. */
export async function generateStaticParams() {
  const slugs = await activeCategorySlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  // Next 16 made route params async (D-002).
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);

  if (!category) return { title: 'Collection not found' };

  return {
    title: category.name,
    description: `${category.name} in 22K and 18K gold and 999 silver, hallmarked and priced from today's rate.`,
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ slug }, rawSearchParams] = await Promise.all([params, searchParams]);

  const category = await getCategoryBySlug(slug);
  // An inactive or unknown category is a 404, not an empty grid — §6 SECURITY applies the
  // same rule to products, and a category the shop has retired should not remain a
  // reachable page.
  if (!category) notFound();

  // Every value here is an allowlisted token; anything else is dropped (lib/catalog/filters.ts).
  const filters = parseFilters(rawSearchParams);
  const { products, total, hasMore } = await listProducts(slug, filters);

  const basePath = `/collections/${slug}`;
  const shown = Math.min(filters.page * PAGE_SIZE, total);

  return (
    <Section className="pt-8 md:pt-12">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link
            href="/collections"
            className="text-small font-medium text-taupe-deep hover:underline"
          >
            ← All collections
          </Link>
          <h1 className="text-h1 font-semibold tracking-tight text-ink md:text-h1-lg">
            {category.name}
          </h1>
        </div>

        <FilterSheet basePath={basePath} filters={filters} resultCount={total} />

        {products.length === 0 ? (
          <EmptyState
            title={
              hasActiveFilters(filters)
                ? 'Nothing matches those filters'
                : 'Nothing here yet'
            }
            description={
              hasActiveFilters(filters)
                ? 'Try a wider price or weight range.'
                : 'New pieces are added regularly. Ask us on WhatsApp what is in store.'
            }
            action={
              hasActiveFilters(filters) ? (
                <Link href={basePath}>
                  <Button variant="outline" size="md">
                    Clear filters
                  </Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <ProductGrid>
              {products.map((product, index) => (
                <li key={product.id}>
                  {/* §6.5: priority only on what is above the fold — the first row. */}
                  <ProductCard
                    product={product}
                    priority={filters.page === 1 && index < 2}
                  />
                </li>
              ))}
            </ProductGrid>

            <p className="text-center text-small text-muted">
              Showing {shown} of {total}
            </p>

            {/*
              §6.1: "'Load more' (not infinite scroll — infinite scroll makes the footer
              unreachable and hurts back-navigation)."

              A link, not a button: it raises `?page=`, so the browser's back button
              returns to the previous set and the URL always describes what is on screen.
            */}
            {hasMore && (
              <div className="flex justify-center">
                <Link
                  href={`${basePath}${filtersToQuery({ ...filters, page: filters.page + 1 })}`}
                  data-testid="load-more"
                >
                  <Button variant="outline" size="lg">
                    Load more
                  </Button>
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
