/**
 * /admin/products — the catalogue list.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4), redesigned by Stage 5D.
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
 *
 * ── Stage 5D: the list shows the piece ──
 *
 * §2 asks that an admin immediately understand image, name, purity, weight, price and
 * status. The Phase 7 list had four of those and not the first: it counted the images
 * (`_count.images`) without ever selecting one, so a jeweller scanned a catalogue of
 * jewellery as a column of text. The thumbnail is the fix, and it is also the only part of
 * this screen that needs to be visually rich (§22).
 *
 * ── And it quotes the same number as the shop ──
 *
 * The pricing here is `priceProduct` — the storefront's own function — rather than the
 * private `priceOf` this file used to carry. That helper's comment said "the admin list must
 * not quote a different number" while passing `gstPct: 3` hardcoded; DEBT-024 had already
 * made GST a parameter because the shop sets it in §7.9. With a non-default GST the list
 * disagreed with the product page, the form's live preview and every bill. Fixed here rather
 * than logged, because §10 requires the figure to be labelled and the label would have been
 * the lie. D-091.
 */
import { ImageOff, Plus, Star, X } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import { Section } from '@/components/shell';
import { Badge, Button, buttonClasses, Card, EmptyState, ImageFrame, Input, Select } from '@/components/ui';
import { rankedAdminProductIds } from '@/lib/admin/product-search';
import { PRODUCT_CARD_SELECT, priceProduct } from '@/lib/catalog/products';
import { db } from '@/lib/db';
import { formatINR } from '@/lib/money';
import { getCurrentRates, RATE_FACES, toRatesByPurity } from '@/lib/rates';
import { getPricingDefaults } from '@/lib/settings';

import type { PurityKey } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Products' };

/** §7.4 caps the page; the header says so rather than implying the catalogue ends here. */
const PAGE_SIZE = 100;

/**
 * The same wording `/admin/rates` uses, derived from the same table.
 *
 * A second hand-written map would be a fourth copy in this repository (the storefront card,
 * the WhatsApp message and the bill renderer each carry one) and the first that could
 * disagree with the page an admin sets the rate on. UI_REDESIGN_DEBT-010 tracks folding the
 * other three together — they are storefront and bill files, which Stage 5D must not touch.
 */
const PURITY_LABEL = Object.fromEntries(
  RATE_FACES.map((face) => [face.purity, face.label]),
) as Record<PurityKey, string>;

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

  const [categories, rates, defaults] = await Promise.all([
    db.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
    getCurrentRates().then(toRatesByPurity),
    getPricingDefaults(),
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

  const where = {
    ...(rankedIds ? { id: { in: rankedIds } } : {}),
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    ...(status === 'live'
      ? { isActive: true }
      : status === 'hidden'
        ? { isActive: false }
        : {}),
  };

  const [rows, matching] = await Promise.all([
    db.product.findMany({
      where,
      // When searching, relevance is the order; `IN` does not preserve one, so the rank is
      // reapplied below. Otherwise: live pieces first, newest first.
      orderBy: rankedIds ? undefined : [{ isActive: 'desc' }, { createdAt: 'desc' }],
      take: PAGE_SIZE,
      select: {
        ...PRODUCT_CARD_SELECT,
        isActive: true,
        _count: { select: { images: true } },
      },
    }),
    // Counted, not inferred from `rows.length` — otherwise a catalogue of exactly 100 and a
    // catalogue of 4,000 read identically, and the second is the one where it matters.
    db.product.count({ where }),
  ]);

  // `IN` does not preserve order, and relevance is the whole point of ranking it.
  if (rankedIds) {
    const rank = new Map(rankedIds.map((id, index) => [id, index]));
    rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }

  const products = rows.map((row) => ({
    ...priceProduct(row, rates, defaults.gstPct),
    isActive: row.isActive,
    imageCount: row._count.images,
  }));

  const filtered = Boolean(q || categorySlug || status !== 'all');
  const categoryName = categories.find((c) => c.slug === categorySlug)?.name;

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-h1 font-semibold tracking-tight text-ink">Products</h1>
            <p className="text-body text-muted">
              {/*
                §10 — the figures below are live and include GST, and a price that is not
                labelled is a price an admin has to guess at. Said once, above the column it
                governs, rather than repeated on every row.
              */}
              Prices are today&rsquo;s, at the current rate and including{' '}
              <span className="num">{defaults.gstPct}</span>% GST.
            </p>
          </div>
          <Link
            href="/admin/products/new"
            className={buttonClasses({ variant: 'accent', size: 'sm' })}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add piece
          </Link>
        </div>

        {/* A plain GET form: no JavaScript needed, and the result is a shareable URL. */}
        <Card className="flex flex-col gap-4" padded={false}>
          <form className="flex flex-col gap-4 p-4 md:p-6" action="/admin/products">
            {/*
              §3 — labelled, not placeholder-only. A placeholder disappears the moment
              somebody types, which is exactly when they need to know what the box holds.
            */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <Input
                type="search"
                name="q"
                label="Search"
                defaultValue={q}
                placeholder="Name, description or collection"
              />
              {/*
                §3: "Do not turn the page into a giant filter panel."

                Stacked, the three controls and their button ran to 370px at 320px wide —
                nearly half a phone screen before the first piece. The two selects pair up
                below `lg`, and `lg:contents` dissolves this wrapper so they rejoin the row
                on a desktop rather than staying boxed together inside it.
              */}
              <div className="grid grid-cols-2 gap-4 lg:contents">
                <Select
                  name="category"
                  label="Collection"
                  defaultValue={categorySlug ?? ''}
                >
                  <option value="">All collections</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.slug}>
                      {category.name}
                    </option>
                  ))}
                </Select>
                <Select name="status" label="Status" defaultValue={status}>
                  <option value="all">All</option>
                  <option value="live">Visible</option>
                  <option value="hidden">Hidden</option>
                </Select>
              </div>
              <Button variant="primary" size="md" type="submit" className="lg:w-auto" full>
                Apply
              </Button>
            </div>
          </form>
        </Card>

        {/*
          §3 — the active state, and the way out of it.

          A `<select>` holding "Hidden" is easy to miss on a page that otherwise looks like
          the whole catalogue. These say what is being applied in words, each one removable
          on its own, and they only exist when a filter does.
        */}
        {filtered && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-small text-muted">
              <span className="num">{matching}</span>{' '}
              {matching === 1 ? 'piece matches' : 'pieces match'}
            </p>
            {q && (
              <FilterPill
                label={`“${q}”`}
                href={hrefWithout({ q, categorySlug, status }, 'q')}
              />
            )}
            {categoryName && (
              <FilterPill
                label={categoryName}
                href={hrefWithout({ q, categorySlug, status }, 'category')}
              />
            )}
            {status !== 'all' && (
              <FilterPill
                label={status === 'live' ? 'Visible only' : 'Hidden only'}
                href={hrefWithout({ q, categorySlug, status }, 'status')}
              />
            )}
            <Link
              href="/admin/products"
              className="flex h-tap items-center px-2 text-small font-semibold text-rose-deep hover:underline"
            >
              Clear all
            </Link>
          </div>
        )}

        {!filtered && (
          <p className="text-small text-muted">
            <span className="num">{matching}</span>{' '}
            {matching === 1 ? 'piece' : 'pieces'} in the catalogue
            {matching > PAGE_SIZE && (
              <>
                {' '}
                — showing the newest <span className="num">{PAGE_SIZE}</span>
              </>
            )}
          </p>
        )}

        {/* §21 — two different empty states, because they have two different ways out. */}
        {products.length === 0 ? (
          filtered ? (
            <Card padded={false}>
              <EmptyState
                title="No pieces match those filters"
                description="Try a different collection, or widen the status."
                action={
                  <Link
                    href="/admin/products"
                    className={buttonClasses({ variant: 'outline', size: 'md' })}
                  >
                    Clear filters
                  </Link>
                }
              />
            </Card>
          ) : (
            <Card padded={false}>
              <EmptyState
                title="No pieces yet"
                description="Add your first piece and it appears on the shop straight away."
                action={
                  <Link
                    href="/admin/products/new"
                    className={buttonClasses({ variant: 'accent', size: 'md' })}
                  >
                    Add the first piece
                  </Link>
                }
              />
            </Card>
          )
        ) : (
          /**
           * §7 — two columns from `lg`, not one row stretched to 1440px.
           *
           * Inside the admin the rail takes 240px, so `lg` is the first breakpoint where a
           * second column is wider than a phone. Below it the rows stack, which is §6's
           * requirement and also the right shape for a thumb.
           */
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {products.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/admin/products/${product.id}`}
                  className="block h-full rounded-card focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                >
                  <Card
                    interactive
                    padded={false}
                    className="grid h-full grid-cols-[64px_1fr] items-start gap-4 p-4 sm:grid-cols-[96px_1fr]"
                  >
                    {/*
                      §14 — a fixed ratio, so a row is the same height before and after the
                      image loads, and `ImageFrame` draws the branded monogram rather than a
                      broken glyph when a piece has no photo.
                    */}
                    <ImageFrame
                      src={product.imageUrl}
                      // The row already names the piece; the picture repeats it. An empty
                      // alt keeps a screen reader on the link text instead of hearing it
                      // twice (the alt text itself belongs to the customer-facing page).
                      alt=""
                      ratio="1/1"
                      sizes="96px"
                      rounded="field"
                      blurDataURL={product.imageBlur ?? undefined}
                    />

                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="line-clamp-2 text-body font-medium text-ink">
                          {product.name}
                        </p>
                        <p className="text-small text-muted">
                          {PURITY_LABEL[product.purity] ?? product.purity} ·{' '}
                          {product.categoryName}
                        </p>
                        <p className="text-small text-muted">
                          <span className="num">
                            {(product.weightMg / 1000).toFixed(3)}
                          </span>{' '}
                          g
                        </p>
                      </div>

                      <p className="text-h3 font-semibold text-ink num">
                        {formatINR(product.price.lineTotal)}
                      </p>

                      {/*
                        §4 — the existing flags, and only when they are true. A row with
                        nothing to say says nothing, so the badges that do appear are worth
                        looking at. Every one carries text; the icon is a second channel,
                        never the only one (WCAG 1.4.1).
                      */}
                      {(!product.isActive ||
                        product.isFeatured ||
                        product.imageCount === 0) && (
                        <div className="flex flex-wrap gap-2">
                          {!product.isActive && <Badge tone="down">Hidden</Badge>}
                          {product.isFeatured && (
                            <Badge tone="neutral">
                              <Star className="size-4" aria-hidden="true" />
                              Featured
                            </Badge>
                          )}
                          {/* §7.2's "products with no images" alert, surfaced where it can
                              be acted on rather than only counted on the dashboard. */}
                          {product.imageCount === 0 && (
                            <Badge tone="outline">
                              <ImageOff className="size-4" aria-hidden="true" />
                              No photo
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

/** One applied filter, removable on its own. A link, so it works with JavaScript off. */
function FilterPill({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-tap items-center gap-2 rounded-pill bg-rose-tint px-4 text-small font-medium text-ink transition-colors duration-fast ease-standard hover:bg-rose/15"
    >
      {label}
      <X className="size-4" aria-hidden="true" />
      <span className="sr-only">— remove this filter</span>
    </Link>
  );
}

/** The current query with one key dropped, for the pill that removes it. */
function hrefWithout(
  current: { q: string; categorySlug?: string; status: string },
  drop: 'q' | 'category' | 'status',
): string {
  const next = new URLSearchParams();
  if (current.q && drop !== 'q') next.set('q', current.q);
  if (current.categorySlug && drop !== 'category')
    next.set('category', current.categorySlug);
  if (current.status !== 'all' && drop !== 'status') next.set('status', current.status);

  const query = next.toString();
  return query ? `/admin/products?${query}` : '/admin/products';
}
