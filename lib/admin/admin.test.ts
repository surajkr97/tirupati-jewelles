/**
 * Phase 7 TEST + SECURITY — admin mutations.
 * specs/07-admin-panel.md:
 *
 *   SECURITY: "Every `/admin` route and API handler independently re-checks role."
 *   SECURITY: "Attempt every admin API call with a customer session → all 404."
 *   SECURITY: "Attempt every admin API call with no session → all 404."
 *   SECURITY: "All admin mutations write an `AuditLog` with actor and IP."
 *   TEST: "CRUD for products, categories, media slots."
 *   TEST: "Slug uniqueness enforced."
 *   TEST: "Category delete with products blocked."
 *   TEST: "Soft-deleted product keeps historical orders intact and renderable."
 *
 * The guard is mocked so the caller's identity can be varied; `requireAdmin` itself belongs
 * to Phase 3 and is tested there. What is under test is that every action consults it and
 * that a refusal writes nothing.
 */
import { Metal, Purity, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

const { guardState, UnauthorisedError } = vi.hoisted(() => {
  class UnauthorisedError extends Error {
    constructor() {
      super('Not authenticated');
      this.name = 'UnauthorisedError';
    }
  }
  return {
    guardState: {
      user: null as { id: string; email: string; role: 'ADMIN' | 'CUSTOMER' } | null,
    },
    UnauthorisedError,
  };
});

vi.mock('@/lib/auth/guard', () => ({
  UnauthorisedError,
  requireAdmin: async () => {
    if (!guardState.user || guardState.user.role !== 'ADMIN')
      throw new UnauthorisedError();
    return guardState.user;
  },
}));

// Same-origin by default; one test flips it.
const { headerState } = vi.hoisted(() => ({
  headerState: {
    entries: { host: 'shop.example', 'x-forwarded-for': '203.0.113.5' } as Record<
      string,
      string
    >,
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(headerState.entries),
}));

// The SSRF guard makes real network calls; product/media image tests stub it so they test
// the action rather than the internet. The guard has its own suite in lib/media/ssrf.test.ts.
const { urlCheck } = vi.hoisted(() => ({
  urlCheck: {
    result: {
      ok: true,
      url: 'https://res.cloudinary.com/ok.jpg',
      format: 'jpeg',
      bytes: 1024,
    } as unknown,
  },
}));

vi.mock('@/lib/media/fetch-image', () => ({
  checkImageUrl: async () => urlCheck.result,
  FAILURE_MESSAGE: new Proxy({}, { get: () => 'Rejected.' }),
}));

import {
  deleteCategory,
  reorderCategories,
  saveCategory,
} from '@/app/admin/categories/actions';
import { saveMediaSlot } from '@/app/admin/media/actions';
import {
  addProductImage,
  bulkUpdateProducts,
  deactivateProduct,
  saveProduct,
} from '@/app/admin/products/actions';
import { db } from '@/lib/db';

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = HAS_TEST_DB ? describe : describe.skip;

let adminId: string;
let customerId: string;
let ringsId: string;

const VALID_PRODUCT = {
  name: 'Test Ring',
  description: 'A ring.',
  purity: 'K22_916',
  weightGrams: '10',
  makingPct: '12',
  stoneChargeRupees: '',
  hallmarkNo: '',
  bisCertNo: '',
  isActive: true,
  isFeatured: false,
};

describeDb('admin mutations', () => {
  beforeEach(async () => {
    headerState.entries = { host: 'shop.example', 'x-forwarded-for': '203.0.113.5' };
    urlCheck.result = {
      ok: true,
      url: 'https://res.cloudinary.com/ok.jpg',
      format: 'jpeg',
      bytes: 1024,
    };

    await db.enquiry.deleteMany();
    await db.productImage.deleteMany();
    await db.orderItem.deleteMany();
    await db.order.deleteMany();
    await db.product.deleteMany();
    await db.category.deleteMany();
    await db.mediaSlot.deleteMany();
    await db.auditLog.deleteMany();
    await db.metalRate.deleteMany();
    await db.user.deleteMany();

    const [admin, customer] = await Promise.all([
      db.user.create({
        data: { email: `admin-${Date.now()}@example.com`, role: Role.ADMIN },
        select: { id: true, email: true },
      }),
      db.user.create({
        data: { email: `cust-${Date.now()}@example.com`, role: Role.CUSTOMER },
        select: { id: true, email: true },
      }),
    ]);
    adminId = admin.id;
    customerId = customer.id;
    guardState.user = { id: adminId, email: admin.email!, role: 'ADMIN' };

    await db.metalRate.createMany({
      data: [
        {
          metal: Metal.GOLD,
          purity: Purity.K22_916,
          ratePerGram: 1_184_200n,
          setByUserId: adminId,
        },
        {
          metal: Metal.GOLD,
          purity: Purity.K18_750,
          ratePerGram: 969_300n,
          setByUserId: adminId,
        },
        {
          metal: Metal.SILVER,
          purity: Purity.SILVER_999,
          ratePerGram: 15_890n,
          setByUserId: adminId,
        },
      ],
    });

    const rings = await db.category.create({
      data: { name: 'Rings', slug: 'rings', sortOrder: 0 },
      select: { id: true },
    });
    ringsId = rings.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  // ─────────────────────────────────────────── authorisation

  describe('SECURITY — every mutation re-checks the role', () => {
    /** Every mutating action in the admin panel, with a minimal valid payload. */
    const mutations: [string, () => Promise<{ ok: boolean } & { error?: string }>][] = [
      ['saveProduct', () => saveProduct({ ...VALID_PRODUCT, categoryId: ringsId })],
      [
        'deactivateProduct',
        () => deactivateProduct('00000000-0000-4000-8000-000000000000'),
      ],
      [
        'bulkUpdateProducts',
        () =>
          bulkUpdateProducts({
            ids: ['00000000-0000-4000-8000-000000000000'],
            action: 'activate',
          }),
      ],
      [
        'addProductImage',
        () =>
          addProductImage({
            productId: '00000000-0000-4000-8000-000000000000',
            url: 'https://res.cloudinary.com/x.jpg',
            alt: '',
          }),
      ],
      ['saveCategory', () => saveCategory({ name: 'New', isActive: true })],
      ['deleteCategory', () => deleteCategory('00000000-0000-4000-8000-000000000000')],
      [
        'reorderCategories',
        () => reorderCategories(['00000000-0000-4000-8000-000000000000']),
      ],
      [
        'saveMediaSlot',
        () =>
          saveMediaSlot({
            slotKey: 'HERO_BANNER',
            imageUrl: '',
            linkUrl: '',
            headline: '',
            subtext: '',
            isActive: true,
          }),
      ],
    ];

    it.each(mutations)('%s refuses a signed-out caller', async (_name, run) => {
      guardState.user = null;

      const result = await run();

      // §7 SECURITY: "with no session → all 404". A Server Action cannot return a status,
      // so the equivalent is a message that says nothing about what exists.
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not found.');
    });

    it.each(mutations)('%s refuses a CUSTOMER session', async (_name, run) => {
      guardState.user = { id: customerId, email: 'c@example.com', role: 'CUSTOMER' };

      const result = await run();

      expect(result.ok).toBe(false);
      // Identical to the signed-out message — a customer must not learn that the panel
      // exists from a different error.
      expect(result.error).toBe('Not found.');
    });

    it('writes nothing when refused', async () => {
      guardState.user = { id: customerId, email: 'c@example.com', role: 'CUSTOMER' };

      await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });
      await saveCategory({ name: 'Sneaky', isActive: true });

      expect(await db.product.count()).toBe(0);
      // Only the seeded category.
      expect(await db.category.count()).toBe(1);
      expect(await db.auditLog.count()).toBe(0);
    });

    it('refuses a cross-origin request even from an admin', async () => {
      headerState.entries = { host: 'shop.example', origin: 'https://evil.example' };

      const result = await saveCategory({ name: 'CSRF', isActive: true });

      expect(result.ok).toBe(false);
      // The discriminated union narrows on `ok`, so `error` is only readable here.
      if (!result.ok) expect(result.error).toBe('Bad request.');
      expect(await db.category.count()).toBe(1);
    });
  });

  // ─────────────────────────────────────────── audit trail

  describe('SECURITY — every mutation is audited with actor and IP', () => {
    it('records a product creation', async () => {
      await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });

      const entry = await db.auditLog.findFirstOrThrow({
        where: { action: 'PRODUCT_CREATE' },
      });

      expect(entry.actorId).toBe(adminId);
      expect(entry.ip).toBe('203.0.113.5');
      expect(entry.entity).toBe('Product');
    });

    it('records before and after on an edit, so a change can be reconstructed', async () => {
      const created = await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await saveProduct({
        ...VALID_PRODUCT,
        id: created.data.id,
        categoryId: ringsId,
        name: 'Renamed Ring',
        weightGrams: '12',
      });

      const entry = await db.auditLog.findFirstOrThrow({
        where: { action: 'PRODUCT_EDIT' },
        orderBy: { createdAt: 'desc' },
      });

      expect((entry.before as { name: string }).name).toBe('Test Ring');
      expect((entry.after as { name: string }).name).toBe('Renamed Ring');
      expect((entry.after as { weightMg: number }).weightMg).toBe(12_000);
    });

    it.each([
      [
        'a category',
        async () => saveCategory({ name: 'Bangles', isActive: true }),
        'CATEGORY_CREATE',
      ],
      [
        'a media slot',
        async () =>
          saveMediaSlot({
            slotKey: 'HERO_BANNER',
            imageUrl: 'https://res.cloudinary.com/a.jpg',
            linkUrl: '',
            headline: '',
            subtext: '',
            isActive: true,
          }),
        'MEDIA_SET',
      ],
    ])('records %s', async (_name, run, action) => {
      await run();

      const entry = await db.auditLog.findFirstOrThrow({ where: { action } });
      expect(entry.actorId).toBe(adminId);
      expect(entry.ip).toBe('203.0.113.5');
    });
  });

  // ─────────────────────────────────────────── products

  describe('products', () => {
    it('creates one, converting grams to milligrams and rupees to paise', async () => {
      const result = await saveProduct({
        ...VALID_PRODUCT,
        categoryId: ringsId,
        weightGrams: '8.475',
        stoneChargeRupees: '1250.50',
      });

      expect(result.ok).toBe(true);
      const product = await db.product.findFirstOrThrow();

      // MASTER-SPEC §4: integer milligrams and integer paise, parsed from the decimal text
      // rather than multiplied as floats.
      expect(product.weightMg).toBe(8_475);
      expect(product.stoneCharge).toBe(125_050n);
    });

    it('derives metal from purity so the two cannot disagree', async () => {
      await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId, purity: 'SILVER_999' });

      const product = await db.product.findFirstOrThrow();
      // A GOLD/SILVER_999 pair prices at zero; the form never gets to choose.
      expect(product.metal).toBe(Metal.SILVER);
    });

    it('enforces slug uniqueness with a message that names the clash', async () => {
      await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });
      const second = await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });

      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error).toContain('Test Ring');
        expect(second.field).toBe('slug');
      }
      expect(await db.product.count()).toBe(1);
    });

    it('allows an edit to keep its own slug', async () => {
      const created = await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });
      if (!created.ok) throw new Error('unreachable');

      // The uniqueness check must exclude the row being edited, or saving a product without
      // renaming it fails.
      const edited = await saveProduct({
        ...VALID_PRODUCT,
        id: created.data.id,
        categoryId: ringsId,
        makingPct: '15',
      });

      expect(edited.ok).toBe(true);
    });

    it.each([
      ['a negative weight', { weightGrams: '-5' }],
      ['a weight with too many decimals', { weightGrams: '1.2345' }],
      ['making over 100', { makingPct: '150' }],
      ['a non-numeric weight', { weightGrams: 'abc' }],
      ['an empty name', { name: '' }],
      ['an unknown purity', { purity: 'K24' }],
    ])('rejects %s and writes nothing', async (_name, patch) => {
      const result = await saveProduct({
        ...VALID_PRODUCT,
        categoryId: ringsId,
        ...patch,
      });

      expect(result.ok).toBe(false);
      expect(await db.product.count()).toBe(0);
    });

    it('rejects a category that does not exist', async () => {
      const result = await saveProduct({
        ...VALID_PRODUCT,
        categoryId: '00000000-0000-4000-8000-000000000000',
      });

      expect(result.ok).toBe(false);
      expect(await db.product.count()).toBe(0);
    });

    describe('soft delete — §7.4', () => {
      it('hides the product without removing the row', async () => {
        const created = await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });
        if (!created.ok) throw new Error('unreachable');

        await deactivateProduct(created.data.id);

        const product = await db.product.findUniqueOrThrow({
          where: { id: created.data.id },
        });
        expect(product.isActive).toBe(false);
      });

      it('keeps a historical order intact and renderable', async () => {
        const created = await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });
        if (!created.ok) throw new Error('unreachable');

        const order = await db.order.create({
          data: {
            orderNo: `JW-2026-${Date.now() % 10000}`,
            customerPhone: '+919876543210',
            subtotal: 100n,
            gstAmount: 3n,
            grandTotal: 103n,
            createdByUserId: adminId,
            items: {
              create: {
                productId: created.data.id,
                name: 'Test Ring',
                metal: Metal.GOLD,
                purity: Purity.K22_916,
                weightMg: 10_000,
                ratePerGram: 1_184_200n,
                makingPct: '12',
                gstPct: '3',
                lineTotal: 103n,
              },
            },
          },
          include: { items: true },
        });

        await deactivateProduct(created.data.id);

        /**
         * §7 TEST: "Soft-deleted product keeps historical orders intact and renderable."
         *
         * Worth being precise about *why*, because §7.4's stated reason is only half the
         * story. MASTER-SPEC §5 gives `OrderItem` a bare `productId String?` with **no
         * Prisma relation** — there is no foreign key, and the item snapshots the name,
         * rate, weight and making percentage. So a bill renders from its own copy and would
         * survive even a hard delete.
         *
         * What a hard delete actually destroys is the link back: `productId` would point at
         * nothing, and every admin view that resolves it — "which pieces sold this month" —
         * silently loses those rows. That is the real argument for the soft delete, and it
         * is quieter than "bills break", which is why it is written down here.
         */
        const reloaded = await db.order.findUniqueOrThrow({
          where: { id: order.id },
          include: { items: true },
        });

        expect(reloaded.items).toHaveLength(1);
        // The snapshot: correct regardless of what happened to the product.
        expect(reloaded.items[0]!.name).toBe('Test Ring');
        expect(reloaded.items[0]!.ratePerGram).toBe(1_184_200n);
        expect(reloaded.items[0]!.weightMg).toBe(10_000);

        // And the link still resolves, because the row is still there.
        const linked = await db.product.findUnique({
          where: { id: reloaded.items[0]!.productId! },
        });
        expect(linked).not.toBeNull();
        expect(linked!.isActive).toBe(false);
      });

      it('there is no hard delete to reach for', async () => {
        const actions = await import('@/app/admin/products/actions');

        // §7.4 forbids one. Asserted rather than trusted, because "delete" is the obvious
        // name for the next person to add.
        expect(Object.keys(actions)).not.toContain('deleteProduct');
      });
    });

    describe('bulk actions', () => {
      it('deactivates several at once', async () => {
        const a = await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId, name: 'A' });
        const b = await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId, name: 'B' });
        if (!a.ok || !b.ok) throw new Error('unreachable');

        const result = await bulkUpdateProducts({
          ids: [a.data.id, b.data.id],
          action: 'deactivate',
        });

        expect(result.ok).toBe(true);
        expect(await db.product.count({ where: { isActive: false } })).toBe(2);
      });

      it('refuses to move products into a category that does not exist', async () => {
        const a = await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });
        if (!a.ok) throw new Error('unreachable');

        const result = await bulkUpdateProducts({
          ids: [a.data.id],
          action: 'recategorise',
          categoryId: '00000000-0000-4000-8000-000000000000',
        });

        expect(result.ok).toBe(false);
        expect(
          (await db.product.findUniqueOrThrow({ where: { id: a.data.id } })).categoryId,
        ).toBe(ringsId);
      });
    });

    describe('images', () => {
      it('stores the URL the guard verified, not the one submitted', async () => {
        const created = await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });
        if (!created.ok) throw new Error('unreachable');

        // The guard follows redirects and reports where it landed.
        urlCheck.result = {
          ok: true,
          url: 'https://res.cloudinary.com/final.jpg',
          format: 'jpeg',
          bytes: 2048,
        };

        await addProductImage({
          productId: created.data.id,
          url: 'https://res.cloudinary.com/redirects.jpg',
          alt: 'A ring',
        });

        const image = await db.productImage.findFirstOrThrow();
        expect(image.url).toBe('https://res.cloudinary.com/final.jpg');
      });

      it('refuses a URL the guard rejects', async () => {
        const created = await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });
        if (!created.ok) throw new Error('unreachable');

        urlCheck.result = { ok: false, reason: 'private_address', detail: 'nope' };

        const result = await addProductImage({
          productId: created.data.id,
          url: 'https://res.cloudinary.com/evil.jpg',
          alt: '',
        });

        expect(result.ok).toBe(false);
        expect(await db.productImage.count()).toBe(0);
      });
    });
  });

  // ─────────────────────────────────────────── categories

  describe('categories', () => {
    it('creates one and appends it to the running order', async () => {
      const result = await saveCategory({ name: 'Bangles', isActive: true });

      expect(result.ok).toBe(true);
      const created = await db.category.findFirstOrThrow({ where: { slug: 'bangles' } });
      expect(created.sortOrder).toBe(1);
    });

    it('enforces slug uniqueness', async () => {
      const result = await saveCategory({ name: 'Rings', isActive: true });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('/rings');
    });

    it('BLOCKS deleting a category that still has products, with the count', async () => {
      await saveProduct({ ...VALID_PRODUCT, categoryId: ringsId });

      const result = await deleteCategory(ringsId);

      /**
       * §7.5: "Deleting a category with products is blocked with an explanation and a
       * count. Offer to reassign instead."
       *
       * The message carries all three: what is blocking it, how many, and the way out.
       * "Cannot delete" alone is where an owner gets stuck and rings the developer — which
       * is exactly what §7 exists to avoid.
       */
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('1 piece');
        expect(result.error).toMatch(/move them|switch this one off/i);
      }
      expect(await db.category.count()).toBe(1);
    });

    it('allows deleting an empty category', async () => {
      const created = await saveCategory({ name: 'Empty', isActive: true });
      if (!created.ok) throw new Error('unreachable');

      expect((await deleteCategory(created.data.id)).ok).toBe(true);
      expect(await db.category.findUnique({ where: { id: created.data.id } })).toBeNull();
    });

    /**
     * §7.5's "category image", reachable at last — UI_REDESIGN_DEBT-014, closed in Stage 5F.
     *
     * `Category.imageUrl` has been selected by the homepage since Phase 3 and written by
     * nothing, so every collection tile on the storefront rendered the branded monogram
     * permanently. The column now goes through the same `checkImageUrl` guard product images
     * and media slots use.
     *
     * The third test is the one that matters. `imageUrl` has three meanings and the
     * difference between two of them is a data-loss bug: the visibility toggle and the
     * reorder path do not send the field, and if `undefined` were treated as "clear" then
     * hiding a collection would silently delete its picture.
     */
    describe('the category image', () => {
      it('stores the URL that was VERIFIED, not the one that was typed', async () => {
        const result = await saveCategory({
          id: ringsId,
          name: 'Rings',
          isActive: true,
          imageUrl: 'https://res.cloudinary.com/typed.jpg',
        });

        expect(result.ok).toBe(true);
        expect(
          (await db.category.findUniqueOrThrow({ where: { id: ringsId } })).imageUrl,
          // `checkImageUrl` follows redirects and reports where it actually landed.
        ).toBe('https://res.cloudinary.com/ok.jpg');
      });

      it('clears the image back to the branded frame on an empty string', async () => {
        await saveCategory({
          id: ringsId,
          name: 'Rings',
          isActive: true,
          imageUrl: 'https://res.cloudinary.com/a.jpg',
        });

        const cleared = await saveCategory({
          id: ringsId,
          name: 'Rings',
          isActive: true,
          imageUrl: '',
        });

        expect(cleared.ok).toBe(true);
        // Null is what `ImageFrame` renders the monogram for.
        expect(
          (await db.category.findUniqueOrThrow({ where: { id: ringsId } })).imageUrl,
        ).toBeNull();
      });

      it('LEAVES the image alone when the field is not sent', async () => {
        await saveCategory({
          id: ringsId,
          name: 'Rings',
          isActive: true,
          imageUrl: 'https://res.cloudinary.com/keep.jpg',
        });

        // Exactly what the visibility toggle sends: no `imageUrl` at all.
        const hidden = await saveCategory({ id: ringsId, name: 'Rings', isActive: false });

        expect(hidden.ok).toBe(true);
        const after = await db.category.findUniqueOrThrow({ where: { id: ringsId } });
        expect(after.isActive).toBe(false);
        expect(after.imageUrl).toBe('https://res.cloudinary.com/ok.jpg');
      });

      it('refuses an image the guard rejects, and says which field', async () => {
        urlCheck.result = { ok: false, reason: 'host_not_allowed', detail: 'evil.example' };

        const result = await saveCategory({
          id: ringsId,
          name: 'Rings',
          isActive: true,
          imageUrl: 'https://evil.example/x.jpg',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.field).toBe('imageUrl');
        // And nothing was written.
        expect(
          (await db.category.findUniqueOrThrow({ where: { id: ringsId } })).imageUrl,
        ).toBeNull();
      });
    });

    it('reorders, and refuses a partial list', async () => {
      const second = await saveCategory({ name: 'Bangles', isActive: true });
      if (!second.ok) throw new Error('unreachable');

      expect((await reorderCategories([second.data.id, ringsId])).ok).toBe(true);
      expect(
        (await db.category.findUniqueOrThrow({ where: { id: second.data.id } }))
          .sortOrder,
      ).toBe(0);

      // A list containing an unknown id would renumber some rows and skip others — the
      // result looks saved but is not the order that was dragged.
      const stale = await reorderCategories([
        second.data.id,
        '00000000-0000-4000-8000-000000000000',
      ]);
      expect(stale.ok).toBe(false);
    });
  });

  // ─────────────────────────────────────────── media

  describe('media slots', () => {
    it('saves a validated URL', async () => {
      const result = await saveMediaSlot({
        slotKey: 'HERO_BANNER',
        imageUrl: 'https://res.cloudinary.com/hero.jpg',
        linkUrl: '/collections/rings',
        headline: 'New season',
        subtext: '',
        isActive: true,
      });

      expect(result.ok).toBe(true);
      const slot = await db.mediaSlot.findUniqueOrThrow({
        where: { slotKey: 'HERO_BANNER' },
      });
      expect(slot.imageUrl).toBe('https://res.cloudinary.com/ok.jpg');
      expect(slot.headline).toBe('New season');
    });

    it('clears a slot back to the branded empty frame', async () => {
      await saveMediaSlot({
        slotKey: 'HERO_BANNER',
        imageUrl: 'https://res.cloudinary.com/a.jpg',
        linkUrl: '',
        headline: '',
        subtext: '',
        isActive: true,
      });

      const cleared = await saveMediaSlot({
        slotKey: 'HERO_BANNER',
        imageUrl: '',
        linkUrl: '',
        headline: '',
        subtext: '',
        isActive: true,
      });

      expect(cleared.ok).toBe(true);
      // §7.6: "Clearing a slot restores the branded empty frame — never a broken image."
      // Null is what `ImageFrame` renders the monogram for.
      expect(
        (await db.mediaSlot.findUniqueOrThrow({ where: { slotKey: 'HERO_BANNER' } }))
          .imageUrl,
      ).toBeNull();
    });

    it('rejects an unknown slot key', async () => {
      const result = await saveMediaSlot({
        slotKey: 'NOT_A_SLOT',
        imageUrl: '',
        linkUrl: '',
        headline: '',
        subtext: '',
        isActive: true,
      });

      expect(result.ok).toBe(false);
      expect(await db.mediaSlot.count()).toBe(0);
    });

    it.each([
      ['javascript:', 'javascript:alert(1)'],
      ['data:', 'data:text/html,<script>alert(1)</script>'],
      ['a protocol-relative URL', '//evil.example/x'],
      ['plain http', 'http://evil.example'],
    ])('rejects %s as a link URL', async (_name, linkUrl) => {
      // Never fetched, so no SSRF check — but rendered as an `href`, and `javascript:` in an
      // href is XSS.
      const result = await saveMediaSlot({
        slotKey: 'HERO_BANNER',
        imageUrl: '',
        linkUrl,
        headline: '',
        subtext: '',
        isActive: true,
      });

      expect(result.ok).toBe(false);
      expect(await db.mediaSlot.count()).toBe(0);
    });

    it('accepts a relative path and an https link', async () => {
      for (const linkUrl of ['/collections/rings', 'https://example.com/x']) {
        const result = await saveMediaSlot({
          slotKey: 'HERO_BANNER',
          imageUrl: '',
          linkUrl,
          headline: '',
          subtext: '',
          isActive: true,
        });
        expect(result.ok, linkUrl).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────── XSS

  describe('SECURITY — a hostile product name is stored as text', () => {
    it('is never interpreted, only escaped at render', async () => {
      const hostile = '<img src=x onerror=alert(1)>';

      const result = await saveProduct({
        ...VALID_PRODUCT,
        categoryId: ringsId,
        name: hostile,
      });

      expect(result.ok).toBe(true);
      const product = await db.product.findFirstOrThrow();

      /**
       * §7 SECURITY: "XSS: product name `<img src=x onerror=alert(1)>` renders as text
       * everywhere it appears."
       *
       * Stored verbatim — sanitising on write would corrupt a legitimate name containing an
       * angle bracket and still not help, because the defence is at render. React escapes
       * every interpolation, there is no `dangerouslySetInnerHTML` in the codebase, and the
       * WhatsApp message goes through `encodeURIComponent`.
       */
      expect(product.name).toBe(hostile);
      // And the slug — which reaches a URL — has been stripped to safe characters.
      expect(product.slug).toMatch(/^[a-z0-9-]+$/);
    });
  });
});
