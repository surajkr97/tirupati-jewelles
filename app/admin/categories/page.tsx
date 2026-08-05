/**
 * /admin/categories — collections.
 * Created by Phase 7 (specs/07-admin-panel.md §7.5).
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { CategoryManager } from '@/components/admin/category-manager';
import { Section } from '@/components/shell';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Collections' };

export default async function AdminCategoriesPage() {
  const categories = await db.category.findMany({
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      _count: { select: { products: true } },
    },
  });

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link href="/admin/media" className="text-small font-medium text-taupe-deep">
            ← More
          </Link>
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Collections</h1>
          <p className="text-body text-muted">
            The order here is the order they appear on the site.
          </p>
        </div>

        <CategoryManager
          categories={categories.map((category) => ({
            id: category.id,
            name: category.name,
            slug: category.slug,
            isActive: category.isActive,
            productCount: category._count.products,
          }))}
        />
      </div>
    </Section>
  );
}
