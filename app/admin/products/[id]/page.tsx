/**
 * /admin/products/[id] — edit a piece.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4).
 *
 * Images live here rather than on the create form: a product needs an id before an image
 * can be attached to it, and a two-step flow is honest about that rather than pretending
 * to upload into nothing.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProductForm } from '@/components/admin/product-form';
import { ProductImages } from '@/components/admin/product-images';
import { Section } from '@/components/shell';
import { Card } from '@/components/ui';
import { db } from '@/lib/db';
import { PURITIES, type PurityKey } from '@/lib/pricing';
import { getCurrentRates, toRatesByPurity } from '@/lib/rates';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Edit piece' };

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [product, categories, rates, settings] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    }),
    db.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
    getCurrentRates().then(toRatesByPurity),
    db.settings.findUnique({ where: { id: 'singleton' } }),
  ]);

  if (!product) notFound();

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link href="/admin/products" className="text-small font-medium text-taupe-deep">
            ← Products
          </Link>
          <h1 className="text-h1 font-semibold tracking-tight text-ink">
            {product.name}
          </h1>
          <Link
            href={`/products/${product.slug}`}
            className="text-small text-muted underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on the site ↗
          </Link>
        </div>

        <ProductForm
          categories={categories}
          rates={
            Object.fromEntries(
              PURITIES.map((purity) => [purity, rates[purity].toString()]),
            ) as Record<PurityKey, string>
          }
          gstPct={Number(settings?.defaultGstPct ?? 3)}
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

        <Card className="flex flex-col gap-3">
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
