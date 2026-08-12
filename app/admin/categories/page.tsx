/**
 * /admin/categories — collections.
 * Created by Phase 7 (specs/07-admin-panel.md §7.5), restyled by Stage 5F.
 *
 * ── The "← More" link is gone ──
 *
 * This page, `/admin/settings` and `/admin/audit` each carried a back link reading
 * "← More" that pointed at `/admin/media`. It was the last remnant of Phase 7's dashboard
 * card, and it was wrong twice over: there is no "More" page, and the destination was a
 * different screen entirely. D-063 removed the bottom bar's version of the same lie in
 * Stage 2; the sidebar and the mobile drawer have been the way between admin pages since
 * Stage 5A, so nothing replaces it.
 */
import type { Metadata } from 'next';

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
      imageUrl: true,
      _count: { select: { products: true } },
    },
  });

  return (
    <Section className="pt-6 pb-0">
      {/* §20 — an editing column. Four fields per collection do not read better at 1200px,
          the same measure the rate and product forms use. */}
      <div className="flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Collections</h1>
          <p className="text-body text-muted">
            The order here is the order they appear on the site. Each one can carry a
            picture, which is the tile a customer sees on the homepage.
          </p>
        </div>

        <CategoryManager
          categories={categories.map((category) => ({
            id: category.id,
            name: category.name,
            slug: category.slug,
            isActive: category.isActive,
            imageUrl: category.imageUrl,
            productCount: category._count.products,
          }))}
        />
      </div>
    </Section>
  );
}
