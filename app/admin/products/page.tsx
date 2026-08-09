/**
 * /admin/products — the catalogue list.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4).
 *
 * §7.4: "List with search, category filter, active toggle."
 *
 * Filters live in the URL for the same reason §6.1 put them there: the owner filters to
 * "silver, hidden", edits one, and comes back — the back button should return the list they
 * were looking at, not the unfiltered one.
 *
 * Inactive products are shown here, unlike everywhere else in the application. This is the
 * one screen whose job is to manage them, and a soft-deleted piece the admin cannot find is
 * a piece they cannot bring back.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { Section } from '@/components/shell';
import { Badge, Button, Card } from '@/components/ui';
import { rankedAdminProductIds } from '@/lib/admin/product-search';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { calculateLine, type PurityKey, type RatesByPurity } from '@/lib/pricing';
import { getCurrentRates, toRatesByPurity } from '@/lib/rates';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Products' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (params: Record<string, string | string[] | undefined>, key: string) =>
  typeof params[key] === 'string' ? (params[key] as string) : undefined;

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const q = (one(params, 'q') ?? '').trim().slice(0, 80);
  const categorySlug = one(params, 'category');
  // `all` is the default so the admin sees everything they own; the storefront never does.
  const status =
    one(params, 'status') === 'hidden'
      ? 'hidden'
      : one(params, 'status') === 'live'
        ? 'live'
        : 'all';

  const [categories, rates] = await Promise.all([
    db.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
    getCurrentRates().then(toRatesByPurity),
  ]);

  /**
   * Search runs through the §6.4 indexes, not `contains` (DEBT-023).
   *
   * `name: { contains: q }` could not rank, could not reach the description, and could not
   * match a collection name — so an admin and a customer typing the same words got
   * different answers, and only the customer's were ordered by relevance.
   *
   * Two steps: SQL ranks and returns IDs, Prisma applies the category/status filters and
   * selects the columns. `rankedAdminProductIds` sees inactive products, which the
   * storefront's search must never do — see the note in that module for why it is a
   * separate query rather than a flag.
   */
  const rankedIds = q ? await rankedAdminProductIds(q) : null;

  const products = await db.product.findMany({
    where: {
      ...(rankedIds ? { id: { in: rankedIds } } : {}),
      ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      ...(status === 'live'
        ? { isActive: true }
        : status === 'hidden'
          ? { isActive: false }
          : {}),
    },
    // When searching, relevance is the order; `IN` does not preserve one, so the rank is
    // reapplied below. Otherwise: live pieces first, newest first.
    orderBy: rankedIds ? undefined : [{ isActive: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      isFeatured: true,
      metal: true,
      purity: true,
      weightMg: true,
      makingPct: true,
      stoneCharge: true,
      category: { select: { name: true } },
      _count: { select: { images: true } },
    },
  });

  // `IN` does not preserve order, and relevance is the whole point of ranking it.
  if (rankedIds) {
    const rank = new Map(rankedIds.map((id, index) => [id, index]));
    products.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-h1 font-semibold tracking-tight text-ink">Products</h1>
            <p className="text-body text-muted">{products.length} shown</p>
          </div>
          <Link href="/admin/products/new">
            <Button variant="accent" size="sm">
              Add piece
            </Button>
          </Link>
        </div>

        {/* A plain GET form: no JavaScript needed, and the result is a shareable URL. */}
        <form className="flex flex-col gap-4" action="/admin/products">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name"
            aria-label="Search products"
            className="h-control w-full rounded-field bg-white px-4 text-body text-ink ring-1 ring-line ring-inset focus:ring-2 focus:ring-ink focus:outline-none"
          />
          <div className="flex gap-2">
            <select
              name="category"
              defaultValue={categorySlug ?? ''}
              aria-label="Collection"
              className="h-control flex-1 rounded-field bg-white px-4 text-body text-ink ring-1 ring-line ring-inset"
            >
              <option value="">All collections</option>
              {categories.map((category) => (
                <option key={category.id} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
            <select
              name="status"
              defaultValue={status}
              aria-label="Status"
              className="h-control flex-1 rounded-field bg-white px-4 text-body text-ink ring-1 ring-line ring-inset"
            >
              <option value="all">All</option>
              <option value="live">Visible</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
          <Button variant="outline" size="sm" type="submit">
            Apply
          </Button>
        </form>

        {products.length === 0 ? (
          <Card>
            <p className="text-body text-muted">Nothing matches those filters.</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-4">
            {products.map((product) => {
              const price = priceOf(product, rates);
              return (
                <li key={product.id}>
                  <Link href={`/admin/products/${product.id}`} className="block">
                    <Card className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="truncate text-body font-medium text-ink">
                          {product.name}
                        </p>
                        <p className="text-small text-muted">
                          {product.category.name} · {(product.weightMg / 1000).toFixed(3)}{' '}
                          g
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {!product.isActive && <Badge>Hidden</Badge>}
                          {product.isFeatured && <Badge>Featured</Badge>}
                          {/* §7.2's "products with no images" alert, surfaced where it can
                              be acted on rather than only counted on the dashboard. */}
                          {product._count.images === 0 && <Badge>No image</Badge>}
                        </div>
                      </div>
                      <p className="shrink-0 text-body font-semibold text-ink tabular">
                        {formatINR(price)}
                      </p>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}

/** Same engine as the storefront — the admin list must not quote a different number. */
function priceOf(
  product: {
    metal: string;
    purity: string;
    weightMg: number;
    makingPct: { toNumber(): number };
    stoneCharge: bigint;
  },
  rates: RatesByPurity,
): bigint {
  return calculateLine(
    {
      metal: product.metal === 'SILVER' ? 'SILVER' : 'GOLD',
      purity: product.purity as PurityKey,
      weightMg: product.weightMg,
      makingPct: product.makingPct.toNumber(),
      stoneCharge: product.stoneCharge,
      gstPct: 3,
    },
    rates[product.purity as PurityKey],
  ).lineTotal;
}
