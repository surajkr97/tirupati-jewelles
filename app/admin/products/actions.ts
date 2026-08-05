/**
 * Product mutations.
 * Created by Phase 7 (specs/07-admin-panel.md §7.4).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §7.4: "Delete is a **soft delete** (`isActive = false`). Hard-deleting a product
 *  referenced by historical orders breaks bills."
 *
 *  There is no hard delete in this file, and that is deliberate rather than an omission.
 *  `OrderItem` snapshots a product's name and rate at bill time (MASTER-SPEC §5), so a past
 *  bill survives a deletion — but `OrderItem.productId` points at the row, and Phase 8's
 *  admin views join through it. Removing a product would leave orders referring to nothing.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use server';

import { Metal, Purity } from '@prisma/client';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';

import { adminAction, slugify, type ActionResult } from '@/lib/admin/actions';
import { db } from '@/lib/db';
import { checkImageUrl, FAILURE_MESSAGE } from '@/lib/media/fetch-image';
import { createUploadGrant, isOurUpload, type UploadGrant } from '@/lib/media/upload';
import { isValidCombination } from '@/lib/rates';

const PRODUCTS_TAG = 'products';

async function revalidateProducts() {
  revalidateTag(PRODUCTS_TAG, 'max');
  revalidatePath('/');
  revalidatePath('/collections');
  revalidatePath('/collections/[slug]', 'page');
  revalidatePath('/products/[slug]', 'page');
}

/**
 * §7.4's form, as a schema.
 *
 * Weight arrives in GRAMS because that is what a jeweller weighs in, and is stored as
 * integer milligrams (MASTER-SPEC §4). The conversion happens here and nowhere else, the
 * same rule the rate admin follows for display units.
 */
const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Name is required.').max(120),
  slug: z.string().max(120).optional(),
  description: z.string().max(2000),
  categoryId: z.string().uuid('Choose a collection.'),
  purity: z.enum(['K22_916', 'K18_750', 'SILVER_999']),
  weightGrams: z
    .string()
    .regex(/^\d{1,7}(\.\d{1,3})?$/, 'Weight must be grams, up to 3 decimals.'),
  makingPct: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Making charge must be 0–100.')
    .refine((v) => Number(v) <= 100, 'Making charge must be 0–100.'),
  stoneChargeRupees: z
    .string()
    .regex(/^\d{0,9}(\.\d{1,2})?$/, 'Stone charge must be an amount in rupees.'),
  hallmarkNo: z.string().max(40),
  bisCertNo: z.string().max(40),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
});

/** Grams text → integer milligrams, parsed from the decimal rather than multiplied. */
function gramsToMg(grams: string): number {
  const [whole = '0', fraction = ''] = grams.split('.');
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0') || '0');
}

/** Rupees text → integer paise. Same reasoning: never a float multiplication. */
function rupeesToPaise(rupees: string): bigint {
  if (rupees.trim() === '') return 0n;
  const [whole = '0', fraction = ''] = rupees.split('.');
  return BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}

export async function saveProduct(
  input: unknown,
): Promise<ActionResult<{ id: string; slug: string }>> {
  return adminAction(async ({ audit }) => {
    const parsed = productSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        error: issue?.message ?? 'Check the highlighted fields.',
        field: issue?.path.join('.'),
      };
    }

    const data = parsed.data;
    const purity = data.purity as Purity;
    // Derived, never taken from the form — the two cannot disagree, and a GOLD/SILVER_999
    // pair prices at zero.
    const metal = purity === Purity.SILVER_999 ? Metal.SILVER : Metal.GOLD;

    if (!isValidCombination(metal, purity)) {
      return {
        ok: false,
        error: 'That metal and purity do not go together.',
        field: 'purity',
      };
    }

    const slug = slugify(data.slug?.trim() || data.name);
    if (!slug) {
      return {
        ok: false,
        error: 'That name produces an empty web address.',
        field: 'name',
      };
    }

    // §7 TEST: "Slug uniqueness enforced." Checked here for a readable message; the unique
    // index is what actually guarantees it.
    const clash = await db.product.findFirst({
      where: { slug, ...(data.id ? { NOT: { id: data.id } } : {}) },
      select: { name: true },
    });
    if (clash) {
      return {
        ok: false,
        error: `“${clash.name}” already uses the web address /${slug}.`,
        field: 'slug',
      };
    }

    const category = await db.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    });
    if (!category)
      return {
        ok: false,
        error: 'That collection no longer exists.',
        field: 'categoryId',
      };

    const fields = {
      name: data.name.trim(),
      slug,
      description: data.description.trim() || null,
      categoryId: data.categoryId,
      metal,
      purity,
      weightMg: gramsToMg(data.weightGrams),
      makingPct: data.makingPct,
      stoneCharge: rupeesToPaise(data.stoneChargeRupees),
      hasHallmark: data.hallmarkNo.trim() !== '',
      hallmarkNo: data.hallmarkNo.trim() || null,
      bisCertNo: data.bisCertNo.trim() || null,
      isActive: data.isActive,
      isFeatured: data.isFeatured,
    };

    if (data.id) {
      const before = await db.product.findUnique({ where: { id: data.id } });
      if (!before) return { ok: false, error: 'That piece no longer exists.' };

      await db.product.update({ where: { id: data.id }, data: fields });

      await audit({
        action: 'PRODUCT_EDIT',
        entity: 'Product',
        entityId: data.id,
        before: {
          name: before.name,
          slug: before.slug,
          weightMg: before.weightMg,
          makingPct: before.makingPct.toString(),
          stoneCharge: before.stoneCharge.toString(),
          isActive: before.isActive,
        },
        after: {
          name: fields.name,
          slug: fields.slug,
          weightMg: fields.weightMg,
          makingPct: fields.makingPct,
          stoneCharge: fields.stoneCharge.toString(),
          isActive: fields.isActive,
        },
      });

      await revalidateProducts();
      return { ok: true, data: { id: data.id, slug } };
    }

    const created = await db.product.create({ data: fields });

    await audit({
      action: 'PRODUCT_CREATE',
      entity: 'Product',
      entityId: created.id,
      after: { name: fields.name, slug, weightMg: fields.weightMg },
    });

    await revalidateProducts();
    return { ok: true, data: { id: created.id, slug } };
  });
}

/**
 * §7.4: "Delete is a **soft delete** (`isActive = false`) ... Note this in the UI."
 *
 * The name says what it does. A function called `deleteProduct` that sets a flag is how the
 * next person writes a real delete beside it.
 */
export async function deactivateProduct(id: unknown): Promise<ActionResult<undefined>> {
  return adminAction(async ({ audit }) => {
    if (typeof id !== 'string') return { ok: false, error: 'Unknown piece.' };

    const product = await db.product.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true },
    });
    if (!product) return { ok: false, error: 'That piece no longer exists.' };

    await db.product.update({ where: { id }, data: { isActive: false } });

    await audit({
      action: 'PRODUCT_DEACTIVATE',
      entity: 'Product',
      entityId: id,
      before: { isActive: product.isActive },
      after: { isActive: false },
    });

    await revalidateProducts();
    return { ok: true, data: undefined };
  });
}

/** §7.4: "Bulk actions: activate, deactivate, change category." */
const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(['activate', 'deactivate', 'recategorise']),
  categoryId: z.string().uuid().optional(),
});

export async function bulkUpdateProducts(
  input: unknown,
): Promise<ActionResult<{ count: number }>> {
  return adminAction(async ({ audit }) => {
    const parsed = bulkSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Nothing selected.' };

    const { ids, action, categoryId } = parsed.data;

    if (action === 'recategorise') {
      if (!categoryId)
        return { ok: false, error: 'Choose a collection to move them to.' };

      const category = await db.category.findUnique({
        where: { id: categoryId },
        select: { id: true },
      });
      if (!category) return { ok: false, error: 'That collection no longer exists.' };
    }

    const result = await db.product.updateMany({
      where: { id: { in: ids } },
      data:
        action === 'activate'
          ? { isActive: true }
          : action === 'deactivate'
            ? { isActive: false }
            : { categoryId: categoryId! },
    });

    await audit({
      action: 'PRODUCT_BULK',
      entity: 'Product',
      entityId: `${result.count} products`,
      after: { action, ids, categoryId: categoryId ?? null },
    });

    await revalidateProducts();
    return { ok: true, data: { count: result.count } };
  });
}

// ── Images (§7.4: "multiple images, drag to reorder, alt text per image") ────

const imageSchema = z.object({
  productId: z.string().uuid(),
  url: z.string().min(1).max(2048),
  alt: z.string().max(200),
});

export async function addProductImage(
  input: unknown,
): Promise<ActionResult<{ id: string; url: string }>> {
  return adminAction(async ({ audit }) => {
    const parsed = imageSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Paste an image URL.' };

    const { productId, url, alt } = parsed.data;

    const product = await db.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return { ok: false, error: 'That piece no longer exists.' };

    // The same §7.7 guard the media slots use. A product image is the same class of input
    // and gets the same treatment — there is one validated path, not two.
    const check = await checkImageUrl(url.trim());
    if (!check.ok) {
      return {
        ok: false,
        error: `${FAILURE_MESSAGE[check.reason]} ${check.detail}`.trim(),
        field: 'url',
      };
    }

    const last = await db.productImage.findFirst({
      where: { productId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const created = await db.productImage.create({
      data: {
        productId,
        // The URL that was verified, after redirects — not the one that was typed.
        url: check.url,
        alt: alt.trim() || null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    await audit({
      action: 'PRODUCT_IMAGE_ADD',
      entity: 'Product',
      entityId: productId,
      after: { url: check.url, format: check.format },
    });

    await revalidateProducts();
    return { ok: true, data: { id: created.id, url: check.url } };
  });
}

export async function removeProductImage(id: unknown): Promise<ActionResult<undefined>> {
  return adminAction(async ({ audit }) => {
    if (typeof id !== 'string') return { ok: false, error: 'Unknown image.' };

    const image = await db.productImage.findUnique({
      where: { id },
      select: { id: true, productId: true, url: true },
    });
    if (!image) return { ok: false, error: 'That image is already gone.' };

    await db.productImage.delete({ where: { id } });

    await audit({
      action: 'PRODUCT_IMAGE_REMOVE',
      entity: 'Product',
      entityId: image.productId,
      before: { url: image.url },
    });

    await revalidateProducts();
    return { ok: true, data: undefined };
  });
}

export async function reorderProductImages(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return adminAction(async ({ audit }) => {
    const parsed = z
      .object({
        productId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1).max(50),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Could not save that order.' };

    const { productId, ids } = parsed.data;

    const owned = await db.productImage.findMany({
      where: { id: { in: ids }, productId },
      select: { id: true },
    });
    // Every id must belong to this product — otherwise a crafted payload could renumber
    // another product's gallery.
    if (owned.length !== ids.length) {
      return { ok: false, error: 'That list is out of date. Reload and try again.' };
    }

    await db.$transaction(
      ids.map((id, index) =>
        db.productImage.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    await audit({
      action: 'PRODUCT_IMAGE_REORDER',
      entity: 'Product',
      entityId: productId,
      after: { order: ids },
    });

    await revalidateProducts();
    return { ok: true, data: undefined };
  });
}

// ── Uploads (§7.8) ──────────────────────────────────────────────────────────

/**
 * Issue a signed grant so the browser can upload straight to Cloudinary.
 *
 * §7.8: "The image bytes never pass through the app server." The server's whole
 * contribution is this signature; the transfer is between the browser and the provider.
 */
export async function createUploadTicket(): Promise<ActionResult<UploadGrant>> {
  return adminAction(async () => {
    const grant = createUploadGrant();

    if (!grant) {
      return {
        ok: false,
        error: 'Uploads are not configured. Paste an image link instead.',
      };
    }
    return { ok: true, data: grant };
  });
}

/**
 * Record an upload the browser says succeeded.
 *
 * The client reports its own result, and a client can report anything — so this trusts
 * none of it:
 *
 *   1. The URL must be on our cloud, in our folder, carrying the public id WE issued.
 *   2. It then goes through `checkImageUrl`, the same §7.7 guard a pasted URL gets —
 *      which fetches the bytes and sniffs the magic numbers.
 *
 * Step 2 is the one that matters. §7.7's rule is that a header is not evidence; the same
 * applies to somebody else's validator. Cloudinary rejects a non-image at ingest, and we
 * check again anyway, because "the provider already validated it" is an assumption rather
 * than an observation.
 */
export async function confirmUpload(
  input: unknown,
): Promise<ActionResult<{ id: string; url: string }>> {
  return adminAction(async ({ audit }) => {
    const parsed = z
      .object({
        productId: z.string().uuid(),
        url: z.string().min(1).max(2048),
        publicId: z.string().min(1).max(200),
        alt: z.string().max(200),
      })
      .safeParse(input);
    if (!parsed.success)
      return { ok: false, error: 'That upload could not be recorded.' };

    const { productId, url, publicId, alt } = parsed.data;

    const product = await db.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return { ok: false, error: 'That piece no longer exists.' };

    if (!isOurUpload(url, publicId)) {
      return { ok: false, error: 'That upload does not look like ours.', field: 'url' };
    }

    const check = await checkImageUrl(url);
    if (!check.ok) {
      return {
        ok: false,
        error: `${FAILURE_MESSAGE[check.reason]} ${check.detail}`.trim(),
        field: 'url',
      };
    }

    const last = await db.productImage.findFirst({
      where: { productId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const created = await db.productImage.create({
      data: {
        productId,
        url: check.url,
        alt: alt.trim() || null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    await audit({
      action: 'PRODUCT_IMAGE_UPLOAD',
      entity: 'Product',
      entityId: productId,
      after: { url: check.url, format: check.format, bytes: check.bytes },
    });

    await revalidateProducts();
    return { ok: true, data: { id: created.id, url: check.url } };
  });
}
