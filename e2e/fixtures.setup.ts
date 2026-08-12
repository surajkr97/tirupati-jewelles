/**
 * The data the E2E suite asserts on, created by the E2E suite.
 * Created by Phase 9 §9.8 — DEBT-040's remedy (b).
 *
 * ── Why this exists ──
 * The first push of the rebuild to GitHub ran the suite somewhere other than the machine it
 * was written on, and **14 tests failed for lack of fixtures rather than for a defect**:
 *
 *   /admin/bills: no money figure found to inflate      — a fresh shop has no bills
 *   no CDN request was intercepted — the test is not testing — a fresh shop has no photographs
 *   the sticky CTA does not cover the end of the page   — page geometry with no images
 *
 * DEBT-040 raised this as "assertions go stale because the suite runs against the shared
 * development database, whose data ages and accumulates". CI proved something stronger: they
 * could not run anywhere else **at all**. A suite that only passes on one laptop is not a
 * suite, it is that laptop's opinion.
 *
 * ── The rule this follows ──
 * Ensure, do not overwrite. Every product below is left exactly as it is if it already has
 * photographs, so running this against a real shop — or against the development database with
 * its 92 blur placeholders — changes nothing. It only fills gaps.
 *
 * ── Why a local image and not a Cloudinary URL ──
 * `/e2e/fixture.png` is served by the application itself, so the suite needs no network, no
 * Cloudinary account and no allowlisted host to run. A CI job that fails because a third
 * party is slow teaches nothing. `e2e/degradation.spec.ts` blocks the optimiser endpoint
 * rather than the CDN hostname for the same reason — see the note there.
 */
import { PrismaClient, Metal, Purity, Role } from '@prisma/client';
import { test as setup, expect } from '@playwright/test';

import { calculateLine } from '@/lib/pricing';

const db = new PrismaClient();

/** Served from `public/`, so it resolves without leaving the process. */
const FIXTURE_IMAGE = '/e2e/fixture.png';

/**
 * The products the suite navigates to by name, and how many images each needs.
 *
 * `temple-necklace-set` needs two or more: `e2e/keyboard.spec.ts` skips a single-image
 * product, because a gallery with one slide has nothing to scroll — so one image there would
 * turn a real assertion into a silent skip.
 */
const NEEDS_IMAGES: { slug: string; count: number }[] = [
  { slug: 'classic-solitaire-ring', count: 3 },
  { slug: 'temple-necklace-set', count: 4 },
  { slug: 'jhumka-earrings', count: 2 },
];

setup('the catalogue has photographs', async () => {
  for (const { slug, count } of NEEDS_IMAGES) {
    const product = await db.product.findUnique({
      where: { slug },
      select: { id: true, name: true, _count: { select: { images: true } } },
    });

    // A shop that does not have this piece is not a failure — the seed may change. The
    // tests that need it will say so themselves.
    if (!product) continue;

    /**
     * Only a piece with NO photographs at all is touched.
     *
     * "Top it up to `count`" was the first version and it was wrong in a way the fresh
     * database could not show: on the development machine `temple-necklace-set` has three
     * real photographs and this wanted four, so it would have appended a flat test square
     * to a real gallery. A fixture that edits real data is not a fixture.
     */
    if (product._count.images > 0) continue;

    await db.productImage.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        productId: product.id,
        url: FIXTURE_IMAGE,
        alt: `${product.name} — photograph ${i + 1}`,
        sortOrder: i,
      })),
    });
  }

  const withImages = await db.product.count({ where: { images: { some: {} } } });
  expect(
    withImages,
    'no product has a photograph — the gallery suites cannot run',
  ).toBeGreaterThan(0);
});

/**
 * One bill, so `/admin/bills` has a money figure on it.
 *
 * `e2e/a11y.spec.ts` substitutes a ₹1000-crore figure into every money element and measures
 * the overflow (DEBT-038). With no bills there is nothing to substitute into, and the test
 * fails saying exactly that rather than passing on an empty page — which is the assertion
 * doing its job.
 *
 * Written with Prisma rather than through `createBill`, deliberately: that path allocates a
 * real invoice number from `BillSequence` and §8.2 cannot give one back. A fixture must not
 * consume something the shop's accounts depend on, so this uses an obviously-fake number in
 * a range no real bill will reach.
 */
/**
 * The homepage's images, which do not come from the catalogue.
 *
 * `e2e/degradation.spec.ts` asserts the homepage survives an image CDN outage, and its
 * control checks that at least one image request was actually intercepted — otherwise the
 * test is measuring an empty page. The homepage's pictures are `MediaSlot` rows (§7.6), not
 * `ProductImage`, so filling the catalogue above was not enough: with every slot empty the
 * page renders branded monogram tiles, requests nothing, and the control correctly refuses.
 *
 * Found by running the suite against a freshly seeded database rather than by reasoning about
 * it — 14 failures became 3, and the last 3 were all this.
 */
setup('the homepage has imagery', async () => {
  /**
   * All or nothing, for the same reason as the catalogue above: a shop with SOME slots
   * configured is a real shop, and filling its gaps with a test square would edit what the
   * owner sees. Only a completely unconfigured homepage — a fresh install, which is what CI
   * has — gets fixtures.
   */
  const alreadyHasImagery = await db.mediaSlot.count({
    where: { imageUrl: { not: null } },
  });

  if (alreadyHasImagery === 0) {
    const empty = await db.mediaSlot.findMany({ select: { id: true } });
    for (const slot of empty) {
      await db.mediaSlot.update({
        where: { id: slot.id },
        data: { imageUrl: FIXTURE_IMAGE, isActive: true },
      });
    }
  }

  const filled = await db.mediaSlot.count({ where: { imageUrl: { not: null } } });
  expect(
    filled,
    'no media slot has an image — the homepage renders no pictures',
  ).toBeGreaterThan(0);
});

setup('the shop has at least one bill', async () => {
  const existing = await db.order.count();
  if (existing > 0) return;

  const rate = await db.metalRate.findFirst({
    where: { metal: Metal.GOLD, purity: Purity.K22_916 },
    orderBy: { effectiveAt: 'desc' },
  });
  expect(rate, 'no gold rate seeded — a bill cannot be priced').not.toBeNull();

  // Every bill records who raised it (§8.2). The seeded admin is the only candidate.
  const admin = await db.user.findFirst({ where: { role: Role.ADMIN } });
  expect(admin, 'no admin seeded — a bill has no author').not.toBeNull();

  /**
   * Priced by the engine, not by hand — and that is a correction, not a preference.
   *
   * The figures here were written as literals: `lineTotal: 25_40_399_21n` against a line of
   * 20 g at the seeded ₹11,842/g, which is ₹2,73,218.62 once making and GST are applied.
   * The fixture bill was about ten times its own contents.
   *
   * Nothing noticed for two phases, because nothing recomputed it. `buildBillData` does —
   * it recovers the metal/making split from each line's snapshot and refuses to print a bill
   * whose stored total does not reproduce — so **this fixture's PDF has never been
   * renderable**, and Stage 5E's bill screen, which now shows the same breakdown, put the
   * mismatch on the page in words.
   *
   * `calculateLine` is the function `createBill` itself uses. Deriving from it means the
   * fixture cannot drift from the engine again, and it stays correct when the seeded rate
   * changes — which a literal never could, since the rate is read from the database above.
   */
  const line = calculateLine(
    {
      metal: Metal.GOLD,
      purity: Purity.K22_916,
      weightMg: 20_000,
      makingPct: 12,
      stoneCharge: 0n,
      gstPct: 3,
    },
    rate!.ratePerGram,
  );

  await db.order.create({
    data: {
      orderNo: 'E2E-FIXTURE-0001',
      customerPhone: '+919999900010',
      customerName: 'E2E Fixture',
      createdByUserId: admin!.id,
      subtotal: line.subtotal,
      gstAmount: line.gstAmount,
      grandTotal: line.lineTotal,
      ratesSnapshot: { [Purity.K22_916]: rate!.ratePerGram.toString() },
      items: {
        create: [
          {
            name: 'Fixture necklace',
            metal: Metal.GOLD,
            purity: Purity.K22_916,
            weightMg: 20_000,
            ratePerGram: rate!.ratePerGram,
            makingPct: 12,
            gstPct: 3,
            lineTotal: line.lineTotal,
          },
        ],
      },
    },
  });
});

/**
 * The audit log needs entries to be a log.
 *
 * `/admin/audit` builds its action and record-type filters with `groupBy` over the whole
 * table, and Stage 5F's tests assert that choosing one action does not collapse the list of
 * the others. On a shop that has been trading there are hundreds of entries; on a freshly
 * seeded CI database there are none, so the dropdown holds one option and the assertions
 * fail for lack of data rather than for a defect — DEBT-040's exact shape.
 *
 * Written straight to the table rather than through `adminAction`: this is a log of things
 * that happened, the page reads nothing else, and driving real mutations here would change
 * the shop's rates and catalogue as a side effect of setting up a test.
 */
setup('the audit log has entries', async () => {
  const admin = await db.user.findFirst({ where: { role: Role.ADMIN } });
  expect(admin, 'no admin seeded — an audit entry has no actor').not.toBeNull();

  // Ensure, do not overwrite: a real shop's log is left exactly as it is.
  const distinct = await db.auditLog.groupBy({ by: ['action'] });
  if (distinct.length >= 3) return;

  await db.auditLog.createMany({
    data: [
      {
        actorId: admin!.id,
        action: 'RATE_SET',
        entity: 'MetalRate',
        entityId: `${Metal.GOLD}:${Purity.K22_916}`,
        before: { ratePerGram: '1150000' },
        after: { ratePerGram: '1184200' },
        ip: '203.0.113.5',
      },
      {
        actorId: admin!.id,
        action: 'PRODUCT_EDIT',
        entity: 'Product',
        entityId: 'e2e-fixture-product',
        before: { name: 'Fixture piece', isActive: true },
        after: { name: 'Fixture piece', isActive: false },
        ip: '203.0.113.5',
      },
      {
        actorId: admin!.id,
        action: 'SETTINGS_UPDATE',
        entity: 'Settings',
        entityId: 'singleton',
        before: { billSequence: 1 },
        after: { billSequence: 2 },
        ip: '203.0.113.5',
      },
    ],
  });
});

setup.afterAll(async () => {
  await db.$disconnect();
});
