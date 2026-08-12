/**
 * /admin/products/[id] — edit a piece.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4), restructured by Stage 5D.
 *
 * Images live here rather than on the create form: a product needs an id before an image
 * can be attached to it, and a two-step flow is honest about that rather than pretending
 * to upload into nothing.
 *
 * ── Why Photos sits BELOW the save button, against §8's running order ──
 *
 * §8 puts media between pricing and availability, which is the right order for one form.
 * These are two forms. Every image action — add, reorder, remove — commits on the tap;
 * the fields above commit on Save. Sliding the gallery in above that button would put a
 * group of already-saved controls inside a form that is not saved yet, and the first thing
 * an owner would learn is that Save does not cover their photographs.
 */
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Metadata } from 'next';

import { ProductForm } from '@/components/admin/product-form';
import { ProductImages } from '@/components/admin/product-images';
import { Section } from '@/components/shell';
import { Badge, Card } from '@/components/ui';
import { db } from '@/lib/db';
import { PURITIES, type PurityKey } from '@/lib/pricing';
import { getCurrentRates, toRatesByPurity } from '@/lib/rates';
import { getPricingDefaults } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Edit piece' };

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [product, categories, rates, defaults] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    }),
    db.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
    getCurrentRates().then(toRatesByPurity),
    getPricingDefaults(),
  ]);

  if (!product) notFound();

  return (
    <Section className="pt-6 pb-0">
      {/* §16 — an editing column, the same measure the rate form uses. A row of labelled
          fields does not become easier to read at 1200px. */}
      <div className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link
            href="/admin/products"
            className="flex h-tap w-fit items-center gap-2 text-small font-medium text-rose-deep hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Products
          </Link>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-h1 font-semibold tracking-tight text-ink">
              {product.name}
            </h1>
            {/* §4 — the flag that changes what a customer can see, said in words. */}
            {!product.isActive && <Badge tone="down">Hidden</Badge>}
          </div>

          {/*
            Only offered when the piece is actually reachable. `/products/[slug]` filters on
            `isActive` and 404s otherwise (lib/catalog/products.ts), so a "View on the site"
            link on a hidden piece is a link to a not-found page.
          */}
          {product.isActive ? (
            <Link
              href={`/products/${product.slug}`}
              className="flex h-tap w-fit items-center gap-2 text-small text-muted underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on the site
              <ExternalLink className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <p className="text-small text-muted">
              Hidden pieces are not on the shop, so there is nothing to view yet.
            </p>
          )}
        </div>

        <ProductForm
          categories={categories}
          rates={
            Object.fromEntries(
              PURITIES.map((purity) => [purity, rates[purity].toString()]),
            ) as Record<PurityKey, string>
          }
          gstPct={defaults.gstPct}
          defaultMakingPct={defaults.makingPct}
          initial={{
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description ?? '',
            categoryId: product.categoryId,
            purity: product.purity as PurityKey,
            weightGrams: (product.weightMg / 1000).toFixed(3),
            makingPct: product.makingPct.toString(),
            stoneChargeRupees: (Number(product.stoneCharge) / 100).toFixed(2),
            hallmarkNo: product.hallmarkNo ?? '',
            bisCertNo: product.bisCertNo ?? '',
            isActive: product.isActive,
            isFeatured: product.isFeatured,
          }}
        />

        <ProductImages
          productId={product.id}
          images={product.images.map((image) => ({
            id: image.id,
            url: image.url,
            alt: image.alt ?? '',
          }))}
        />

        <Card className="flex flex-col gap-4">
          <h2 className="text-h3 font-semibold text-ink">Removing a piece</h2>
          {/*
            §7.4: "Delete is a soft delete (isActive = false). Hard-deleting a product
            referenced by historical orders breaks bills. Note this in the UI."
            This is that note — the owner should understand why there is no delete button.
          */}
          <p className="text-body text-muted">
            Pieces are never deleted, only hidden. Past bills refer to them, and a bill
            that cannot find its piece is a bill that will not print. Switch{' '}
            <strong>Visible on the site</strong> off above to take it off the shop.
          </p>
        </Card>
      </div>
    </Section>
  );
}
