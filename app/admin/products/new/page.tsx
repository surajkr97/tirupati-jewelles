/**
 * /admin/products/new — add a piece.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4).
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { ProductForm } from '@/components/admin/product-form';
import { Section } from '@/components/shell';
import { Card } from '@/components/ui';
import { db } from '@/lib/db';
import { PURITIES } from '@/lib/pricing';
import { getCurrentRates, toRatesByPurity } from '@/lib/rates';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Add a piece' };

export default async function NewProductPage() {
  const [categories, rates, settings] = await Promise.all([
    db.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
    getCurrentRates().then(toRatesByPurity),
    db.settings.findUnique({ where: { id: 'singleton' } }),
  ]);

  if (categories.length === 0) {
    // A product needs a collection, so send them there rather than showing a form that
    // cannot be submitted.
    return (
      <Section className="pt-6 pb-0">
        <Card className="flex flex-col gap-4">
          <h1 className="text-h2 font-semibold text-ink">Add a collection first</h1>
          <p className="text-body text-muted">
            Every piece belongs to a collection, and there are none yet.
          </p>
          <Link
            href="/admin/categories"
            className="font-medium text-taupe-deep underline"
          >
            Manage collections
          </Link>
        </Card>
      </Section>
    );
  }

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link href="/admin/products" className="text-small font-medium text-taupe-deep">
            ← Products
          </Link>
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Add a piece</h1>
        </div>

        <ProductForm
          categories={categories}
          rates={
            Object.fromEntries(
              PURITIES.map((purity) => [purity, rates[purity].toString()]),
            ) as Record<(typeof PURITIES)[number], string>
          }
          gstPct={Number(settings?.defaultGstPct ?? 3)}
        />
      </div>
    </Section>
  );
}
