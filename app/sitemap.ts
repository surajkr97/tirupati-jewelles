/**
 * sitemap.xml — Phase 9 §9.6.
 *
 * ── It is generated from the database, not written by hand ──
 * A hand-maintained list of products is wrong the day after the next product is added, and
 * wrong in the direction that matters: the new piece is the one nobody can find. Everything
 * here comes from the same queries the pages themselves use, filtered the same way, so a
 * deactivated product leaves the sitemap at the moment it leaves the catalogue.
 *
 * ── It must not contradict robots.txt ──
 * Listing a URL here and disallowing it there is a crawl error rather than an outcome. Every
 * entry below is a public, indexable route; `lib/seo.test.ts` asserts the two files agree by
 * running each sitemap URL against the robots rules rather than by trusting this comment.
 *
 * `lastModified` is real where the row records one. An invented timestamp — `new Date()` on
 * every build, which is the common shortcut — tells a crawler that every page changed on
 * every deploy and is a good way to have all of them ignored.
 */
import type { MetadataRoute } from 'next';

import { POLICY_SLUGS } from '@/app/(app)/policies/[slug]/page';
import { db } from '@/lib/db';
import { absoluteUrl } from '@/lib/seo';

/** Matches each route's own `export const revalidate`, so the hint is not a guess. */
const CHANGE_FREQUENCY = {
  rates: 'hourly',
  catalogue: 'daily',
  static: 'monthly',
} as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories, newestRate] = await Promise.all([
    db.product.findMany({
      // The same filter the storefront applies. A soft-deleted piece 404s (§6 SECURITY), so
      // listing it here would be advertising a dead link.
      where: { isActive: true, category: { isActive: true } },
      select: { slug: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.category.findMany({
      where: { isActive: true },
      select: { slug: true },
      orderBy: { sortOrder: 'asc' },
    }),
    db.metalRate.findFirst({
      select: { effectiveAt: true },
      orderBy: { effectiveAt: 'desc' },
    }),
  ]);

  const ratesUpdated = newestRate?.effectiveAt ?? new Date();

  return [
    {
      url: absoluteUrl('/'),
      lastModified: ratesUpdated,
      changeFrequency: CHANGE_FREQUENCY.rates,
      priority: 1,
    },
    {
      url: absoluteUrl('/rates'),
      lastModified: ratesUpdated,
      changeFrequency: CHANGE_FREQUENCY.rates,
      priority: 0.9,
    },
    {
      url: absoluteUrl('/collections'),
      changeFrequency: CHANGE_FREQUENCY.catalogue,
      priority: 0.8,
    },
    {
      url: absoluteUrl('/calculator'),
      changeFrequency: CHANGE_FREQUENCY.static,
      priority: 0.7,
    },

    ...categories.map((category) => ({
      url: absoluteUrl(`/collections/${category.slug}`),
      changeFrequency: CHANGE_FREQUENCY.catalogue,
      priority: 0.7,
    })),

    ...products.map((product) => ({
      url: absoluteUrl(`/products/${product.slug}`),
      lastModified: product.createdAt,
      changeFrequency: CHANGE_FREQUENCY.catalogue,
      priority: 0.6,
    })),

    // Imported from the route rather than restated, so a policy added there appears here.
    ...POLICY_SLUGS.map((slug) => ({
      url: absoluteUrl(`/policies/${slug}`),
      changeFrequency: CHANGE_FREQUENCY.static,
      priority: 0.3,
    })),
  ];
}
