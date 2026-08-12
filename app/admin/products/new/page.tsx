/**
 * /admin/products/new — add a piece.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4), restructured by Stage 5D.
 */
import { ArrowLeft, Camera } from 'lucide-react';
import Link from 'next/link';

import type { Metadata } from 'next';

import { ProductForm } from '@/components/admin/product-form';
import { Section } from '@/components/shell';
import { buttonClasses, Card, EmptyState } from '@/components/ui';
import { db } from '@/lib/db';
import { PURITIES } from '@/lib/pricing';
import { getCurrentRates, toRatesByPurity } from '@/lib/rates';
import { getPricingDefaults } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Add a piece' };

export default async function NewProductPage() {
  const [categories, rates, defaults] = await Promise.all([
    db.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
    getCurrentRates().then(toRatesByPurity),
    getPricingDefaults(),
  ]);

  if (categories.length === 0) {
    // A product needs a collection, so send them there rather than showing a form that
    // cannot be submitted.
    return (
      <Section className="pt-6 pb-0">
        <div className="max-w-2xl">
          <Card padded={false}>
            <EmptyState
              titleAs="h1"
              title="Add a collection first"
              description="Every piece belongs to a collection, and there are none yet."
              action={
                <Link
                  href="/admin/categories"
                  className={buttonClasses({ variant: 'accent', size: 'md' })}
                >
                  Manage collections
                </Link>
              }
            />
          </Card>
        </div>
      </Section>
    );
  }

  return (
    <Section className="pt-6 pb-0">
      {/* §16 — the same editing measure as the edit page and the rate form. */}
      <div className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link
            href="/admin/products"
            className="flex h-tap w-fit items-center gap-2 text-small font-medium text-rose-deep hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Products
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
          gstPct={defaults.gstPct}
          defaultMakingPct={defaults.makingPct}
        />

        {/*
          §19 — the two-step flow, said out loud.

          A photo needs a product id to belong to, so there is nothing to upload into until
          this is saved. The create page used to say that only in a source comment, which
          left an owner looking for the upload control they had seen on the edit screen.
        */}
        <Card className="flex flex-row items-start gap-4">
          <Camera className="size-6 shrink-0 text-muted" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <h2 className="text-body font-semibold text-ink">Photos come next</h2>
            <p className="text-small text-muted">
              Save the piece first — photographs attach to it once it exists. An{' '}
              <strong>Add photos</strong> link appears here the moment it saves.
            </p>
          </div>
        </Card>
      </div>
    </Section>
  );
}
