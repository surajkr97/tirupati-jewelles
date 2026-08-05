/**
 * Category mutations.
 * Created by Phase 7 (specs/07-admin-panel.md §7.5).
 *
 * §7.5: "Deleting a category with products is blocked with an explanation and a count.
 * Offer to reassign instead."
 *
 * That block is the interesting rule here. Prisma's schema makes `Product.categoryId`
 * required, so a delete would fail at the database anyway — but as a foreign-key error the
 * admin cannot act on. Checking first turns it into a sentence that tells them what to do.
 */
'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';

import { adminAction, slugify, type ActionResult } from '@/lib/admin/actions';
import { db } from '@/lib/db';

/** MASTER-SPEC §6 names `categories` among the revalidation tags. */
const CATEGORIES_TAG = 'categories';
const CATEGORY_SURFACES = ['/', '/collections'] as const;

async function revalidateCategories() {
  revalidateTag(CATEGORIES_TAG, 'max');
  for (const path of CATEGORY_SURFACES) revalidatePath(path);
  revalidatePath('/collections/[slug]', 'page');
}

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Name is required.').max(80),
  slug: z.string().max(80).optional(),
  isActive: z.boolean(),
});

export async function saveCategory(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return adminAction(async ({ audit }) => {
    const parsed = upsertSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Check the highlighted fields.',
        field: 'name',
      };
    }

    const { id, name, isActive } = parsed.data;
    const slug = slugify(parsed.data.slug?.trim() || name);

    if (!slug) {
      return {
        ok: false,
        error: 'That name produces an empty web address.',
        field: 'name',
      };
    }

    // Checked before the write so the admin gets a sentence rather than a unique-constraint
    // error. The database constraint is still the real guarantee.
    const clash = await db.category.findFirst({
      where: { slug, ...(id ? { NOT: { id } } : {}) },
      select: { id: true, name: true },
    });
    if (clash) {
      return {
        ok: false,
        error: `“${clash.name}” already uses the web address /${slug}.`,
        field: 'slug',
      };
    }

    if (id) {
      const before = await db.category.findUnique({ where: { id } });
      if (!before) return { ok: false, error: 'That collection no longer exists.' };

      const after = await db.category.update({
        where: { id },
        data: { name, slug, isActive },
      });

      await audit({
        action: 'CATEGORY_EDIT',
        entity: 'Category',
        entityId: id,
        before: { name: before.name, slug: before.slug, isActive: before.isActive },
        after: { name: after.name, slug: after.slug, isActive: after.isActive },
      });

      await revalidateCategories();
      return { ok: true, data: { id } };
    }

    // Appended to the end of the running order rather than jumping to the front.
    const last = await db.category.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const created = await db.category.create({
      data: { name, slug, isActive, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });

    await audit({
      action: 'CATEGORY_CREATE',
      entity: 'Category',
      entityId: created.id,
      after: { name, slug, isActive },
    });

    await revalidateCategories();
    return { ok: true, data: { id: created.id } };
  });
}

export async function deleteCategory(id: unknown): Promise<ActionResult<undefined>> {
  return adminAction(async ({ audit }) => {
    if (typeof id !== 'string') return { ok: false, error: 'Unknown collection.' };

    const category = await db.category.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { products: true } },
      },
    });
    if (!category) return { ok: false, error: 'That collection no longer exists.' };

    /**
     * §7.5's block, with the count and the way out.
     *
     * Deleting anyway is not an option: `Product.categoryId` is required, so the products
     * would have nowhere to go, and cascading would silently destroy the catalogue. The
     * message says what to do instead because "cannot delete" without a next step is where
     * an owner gets stuck and calls the developer — which §7 exists to avoid.
     */
    if (category._count.products > 0) {
      return {
        ok: false,
        error:
          `“${category.name}” still has ${category._count.products} ` +
          `${category._count.products === 1 ? 'piece' : 'pieces'} in it. ` +
          `Move them to another collection first, or switch this one off instead of deleting it.`,
      };
    }

    await db.category.delete({ where: { id } });

    await audit({
      action: 'CATEGORY_DELETE',
      entity: 'Category',
      entityId: id,
      before: { name: category.name, slug: category.slug },
    });

    await revalidateCategories();
    return { ok: true, data: undefined };
  });
}

/** §7.5: "drag-to-reorder". The client sends the whole order; one transaction applies it. */
export async function reorderCategories(ids: unknown): Promise<ActionResult<undefined>> {
  return adminAction(async ({ audit }) => {
    const parsed = z.array(z.string().uuid()).min(1).max(100).safeParse(ids);
    if (!parsed.success) return { ok: false, error: 'Could not save that order.' };

    const known = await db.category.findMany({
      where: { id: { in: parsed.data } },
      select: { id: true },
    });
    // A partial order would renumber some rows and leave others, which is worse than
    // refusing: the result looks saved but is not the order the admin dragged.
    if (known.length !== parsed.data.length) {
      return { ok: false, error: 'That list is out of date. Reload and try again.' };
    }

    await db.$transaction(
      parsed.data.map((id, index) =>
        db.category.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    await audit({
      action: 'CATEGORY_REORDER',
      entity: 'Category',
      entityId: 'all',
      after: { order: parsed.data },
    });

    await revalidateCategories();
    return { ok: true, data: undefined };
  });
}
