/**
 * /admin/bills/new — raise a bill.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.1).
 *
 * §8 DESIGN: "The bill builder is usable standing in a shop with one hand." So the page is
 * a thin server shell — it fetches the catalogue for "Load from product" and hands it to
 * one client island. Everything interactive lives in `BillBuilder`.
 *
 * The admin layout already calls `requireAdminPage()`, and `proxy.ts` 404s the whole tree
 * without a session cookie. Both are stated in §7.1 and neither is relied on alone.
 */
import type { Metadata } from 'next';

import { BillBuilder, type ProductOption } from '@/components/admin/bill-builder';
import { Section } from '@/components/shell';
import { db } from '@/lib/db';
import type { PurityKey } from '@/lib/pricing';
import { getPricingDefaults } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'New bill' };

/** Milligrams → the grams string the shared item state holds. */
function grams(weightMg: number): string {
  return (weightMg / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
}

/** Paise → the rupees string the shared item state holds. */
function rupees(paise: bigint): string {
  return paise === 0n ? '' : (Number(paise) / 100).toFixed(2).replace(/\.00$/, '');
}

export default async function NewBillPage() {
  /**
   * Active pieces only, and only what the prefill needs.
   *
   * Bounded at 500 because this is a `<select>`, not a search — a shop with more stock than
   * that needs the picker to become a lookup, and pretending otherwise would ship a page
   * that renders three thousand options on a phone.
   */
  const defaults = await getPricingDefaults();

  const products = await db.product.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    take: 500,
    select: {
      id: true,
      name: true,
      purity: true,
      weightMg: true,
      makingPct: true,
      stoneCharge: true,
      hallmarkNo: true,
      bisCertNo: true,
    },
  });

  const options: ProductOption[] = products.map((product) => ({
    id: product.id,
    name: product.name,
    purity: product.purity as PurityKey,
    weightGrams: grams(product.weightMg),
    makingPct: String(product.makingPct).replace(/\.?0+$/, '') || '0',
    stoneChargeRupees: rupees(product.stoneCharge),
    hallmarkNo: product.hallmarkNo ?? '',
    bisCertNo: product.bisCertNo ?? '',
  }));

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <h1 className="text-h1 font-semibold tracking-tight text-ink">New bill</h1>
        <BillBuilder products={options} defaults={defaults} />
      </div>
    </Section>
  );
}
