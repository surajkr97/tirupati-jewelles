/**
 * Turning a stored order into invoice bytes.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.3).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERY FIGURE ON THE PAGE IS READ, NEVER RECOMPUTED.
 *
 *  §8.2 snapshots `ratePerGram`, `makingPct` and `gstPct` onto each `OrderItem` so that "a
 *  bill reprinted in 2031 must show 2026's numbers". That promise only holds if the
 *  reprint reads the snapshot — a renderer that called `calculateLine` with today's rate
 *  would quietly reissue the invoice at a new price, which is the exact failure the
 *  snapshot exists to prevent.
 *
 *  So `calculateLine` appears here exactly once, applied to the SNAPSHOTTED rate, and only
 *  to recover the metal/making/stone split that the schema does not store per line. Fed
 *  the stored inputs it reproduces the stored `lineTotal` by construction; an assertion
 *  below says so out loud, because "by construction" is a claim and this is the one place
 *  a customer would find out it was wrong.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import { Metal, Purity } from '@prisma/client';
import { renderToBuffer } from '@react-pdf/renderer';

import { getBillLogo } from '@/lib/bills/logo';
import { BillDocument, type BillPdfData, type BillPdfItem } from '@/lib/bills/pdf';
import { pdfText, pdfTextOrNull } from '@/lib/bills/pdf-text';
import { halfRateLabel } from '@/lib/bills/tax';
import { formatShopDate, formatShopDateTime } from '@/lib/datetime';
import { db } from '@/lib/db';
import { calculateLine, type PurityKey } from '@/lib/pricing';
import { toDisplayUnit } from '@/lib/rates';

/**
 * How the purity reads on a legal document — the caratage and the fineness.
 *
 * Exported by Stage 5E for the admin's bill screen, which was rendering
 * `String(item.purity).replace('_', ' ')` and so showed an admin the raw Prisma enum:
 * "K22 916" on screen against "22K (916)" on the invoice for the same line. A fifth
 * hand-written copy would have been the wrong fix (UI_REDESIGN_DEBT-010).
 */
export const BILL_PURITY_LABEL: Record<PurityKey, string> = {
  K22_916: '22K (916)',
  K18_750: '18K (750)',
  SILVER_999: 'Silver (999)',
};

const PURITY_ORDER: { key: PurityKey; metal: Metal; label: string }[] = [
  { key: 'K22_916', metal: Metal.GOLD, label: 'Gold 22K' },
  { key: 'K18_750', metal: Metal.GOLD, label: 'Gold 18K' },
  { key: 'SILVER_999', metal: Metal.SILVER, label: 'Silver 999' },
];

/**
 * §8.5's detail page and the trust block both promise terms. Until the owner supplies real
 * ones (DEBT-018) the invoice states only what the site already says, which is better than
 * inventing a policy on a legal document.
 */
const BUYBACK_LINE =
  'Buyback and exchange are offered on pieces purchased here, against this invoice, at the ' +
  'prevailing rate on the day of return, less applicable deductions. Ask in store for terms.';

export interface OrderForPdf {
  orderNo: string;
  createdAt: Date;
  customerName: string | null;
  customerPhone: string;
  note: string | null;
  subtotal: bigint;
  gstAmount: bigint;
  grandTotal: bigint;
  ratesSnapshot: unknown;
  ratesAt: Date | null;
  voidedAt: Date | null;
  items: {
    name: string;
    metal: Metal;
    purity: Purity;
    weightMg: number;
    ratePerGram: bigint;
    makingPct: { toString(): string };
    stoneCharge: bigint;
    gstPct: { toString(): string };
    lineTotal: bigint;
    hallmarkNo: string | null;
    bisCertNo: string | null;
  }[];
}

/** Everything the document needs that is not on the order. */
export interface ShopIdentity {
  shopName: string;
  address: string | null;
  gstin: string | null;
  contactPhone: string | null;
}

export async function loadShopIdentity(): Promise<ShopIdentity> {
  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: { shopName: true, address: true, gstin: true, contactPhone: true },
  });

  return {
    shopName: settings?.shopName ?? 'Tirupati Jewelles',
    address: settings?.address ?? null,
    gstin: settings?.gstin ?? null,
    contactPhone: settings?.contactPhone ?? null,
  };
}

/** Grams from integer milligrams, trailing zeros trimmed — `8.475`, `10`. */
function grams(weightMg: number): string {
  return (weightMg / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
}

/** Percentages print as the shop typed them: `12`, not `12.00`. */
function percent(value: { toString(): string }): string {
  return String(value).replace(/\.?0+$/, '') || '0';
}

/**
 * The metal / making / stone split for one stored line, recovered from its own snapshot.
 *
 * Exported by Stage 5E so the admin's bill screen shows the same breakdown the customer's
 * invoice does — from the same call, not from a second one written beside it. §8/§9 of the
 * 5E brief ask the detail page to show where the money went, and the schema stores only
 * `lineTotal`; the alternative to this was arithmetic in a component, which is precisely
 * what this module's header exists to forbid.
 *
 * Same engine, same snapshotted inputs, so `line.lineTotal` equals the stored
 * `item.lineTotal`. If it ever does not, the stored value is authoritative and something
 * upstream is broken — so it is checked rather than trusted, and the caller decides what to
 * do about it. `buildBillData` refuses to print; the screen degrades to the stored figures
 * and says why.
 */
export function splitStoredLine(
  item: OrderForPdf['items'][number],
  orderNo: string,
): ReturnType<typeof calculateLine> {
  const line = calculateLine(
    {
      metal: item.metal,
      purity: item.purity as PurityKey,
      weightMg: item.weightMg,
      makingPct: Number(item.makingPct),
      stoneCharge: item.stoneCharge,
      gstPct: Number(item.gstPct),
    },
    item.ratePerGram,
  );

  if (line.lineTotal !== item.lineTotal) {
    throw new Error(
      `Bill ${orderNo}: stored line total ${item.lineTotal} does not match the ` +
        `snapshot recomputation ${line.lineTotal}. Refusing to print a bill that ` +
        `disagrees with itself.`,
    );
  }

  return line;
}

/**
 * The rate reference block.
 *
 * Reads `ratesSnapshot` when the order carries one. Orders written before the snapshot
 * column existed fall back to the rates that were actually applied to their own lines,
 * which is less complete but never wrong.
 *
 * Exported by Stage 5E: §7 of that brief puts the rate snapshot in the detail page's
 * hierarchy, and it was on the invoice and nowhere on the screen — so an admin answering
 * "what rate did we bill this at?" had to open the PDF.
 */
export function billRateReference(order: OrderForPdf): BillPdfData['rates'] {
  const snapshot =
    order.ratesSnapshot && typeof order.ratesSnapshot === 'object'
      ? (order.ratesSnapshot as Record<string, unknown>)
      : null;

  return PURITY_ORDER.flatMap(({ key, metal, label }) => {
    const raw = snapshot?.[key];
    const fromSnapshot =
      typeof raw === 'string' && /^\d+$/.test(raw) ? BigInt(raw) : undefined;

    const applied = order.items.find((item) => item.purity === key)?.ratePerGram;
    const perGram = fromSnapshot ?? applied;
    if (perGram === undefined) return [];

    return [
      {
        label,
        amount: toDisplayUnit(metal, perGram),
        unit: metal === Metal.GOLD ? 'per 10g' : 'per 1kg',
      },
    ];
  });
}

export function buildBillData(
  order: OrderForPdf,
  shop: ShopIdentity,
  logo: BillPdfData['logo'],
): BillPdfData {
  const items: BillPdfItem[] = order.items.map((item) => {
    const purity = item.purity as PurityKey;

    // The split, recovered from the snapshot — and asserted against the stored total.
    const line = splitStoredLine(item, order.orderNo);

    return {
      // Every free-text field goes through `pdfText` — see its header. An emoji in a
      // product name printed as `=O` on a live render, which is the kind of thing only a
      // rendered page shows you.
      name: pdfText(item.name, 'Item'),
      purityLabel: BILL_PURITY_LABEL[purity] ?? String(item.purity),
      weight: grams(item.weightMg),
      ratePerGram: item.ratePerGram,
      metalValue: line.metalValue,
      makingPct: percent(item.makingPct),
      makingCharge: line.makingCharge,
      stoneCharge: line.stoneCharge,
      taxableValue: line.subtotal,
      hallmarkNo: pdfTextOrNull(item.hallmarkNo),
      bisCertNo: pdfTextOrNull(item.bisCertNo),
    };
  });

  /**
   * The component totals §10 of the Stage 5G brief asks for — metal, making, stones.
   *
   * Summed from the per-line split above, which `splitStoredLine` already produced from each
   * line's own snapshot and already asserted against its stored `lineTotal`. Nothing is
   * recomputed: this adds up figures the engine produced, exactly as `summariseTotal` does
   * for the calculator and as `/admin/bills/[id]` does for the same three rows.
   *
   * Null when the parts do not add up to the stored taxable total. A breakdown that does not
   * reconcile with the figure beneath it is worse than no breakdown on a screen and far worse
   * on a tax document — the invoice falls back to the stored totals alone. It cannot happen
   * without a line already having thrown above, and it is checked anyway.
   */
  const metal = items.reduce((sum, item) => sum + item.metalValue, 0n);
  const making = items.reduce((sum, item) => sum + item.makingCharge, 0n);
  const stone = items.reduce((sum, item) => sum + item.stoneCharge, 0n);
  const components =
    metal + making + stone === order.subtotal ? { metal, making, stone } : null;

  return {
    shopName: pdfText(shop.shopName, 'Tirupati Jewelles'),
    address: pdfTextOrNull(shop.address),
    gstin: pdfTextOrNull(shop.gstin),
    contactPhone: pdfTextOrNull(shop.contactPhone),
    logo,
    orderNo: order.orderNo,
    issuedOn: formatShopDateTime(order.createdAt),
    /**
     * §8 SECURITY: "Customer name and note fields escaped in the PDF."
     *
     * The escaping that matters in a PDF is not HTML escaping — there is no markup here —
     * it is that the string cannot break the content stream or smuggle an unrenderable
     * byte past the encoder. `pdfText` is that boundary, and the fallback is deliberate:
     * a name that reduces to nothing must still print as something a human can read.
     */
    customerName: pdfTextOrNull(order.customerName, 'Customer'),
    customerPhone: pdfText(order.customerPhone),
    note: pdfTextOrNull(order.note),
    ratesAppliedOn: formatShopDate(order.ratesAt ?? order.createdAt).toUpperCase(),
    rates: billRateReference(order),
    items,
    components,
    taxableTotal: order.subtotal,
    gstTotal: order.gstAmount,
    grandTotal: order.grandTotal,
    halfRate: halfRateLabel(order.items.map((item) => Number(item.gstPct))),
    voidedOn: order.voidedAt ? formatShopDateTime(order.voidedAt) : null,
    buybackPolicy: BUYBACK_LINE,
  };
}

/**
 * Render an order to PDF bytes.
 *
 * §8.3: "Generate synchronously for now (it takes ~1s). Phase 9 moves it to Celery if it
 * becomes a bottleneck." Phase 9 moved it to BullMQ instead, not Celery — see `lib/queue/`
 * and D-042.
 */
export async function renderBillPdf(order: OrderForPdf): Promise<Buffer> {
  const [shop, logo] = await Promise.all([loadShopIdentity(), getBillLogo()]);
  return renderToBuffer(BillDocument({ bill: buildBillData(order, shop, logo) }));
}

/** The `select` a caller needs for `renderBillPdf`. One definition, so it cannot drift. */
export const ORDER_PDF_SELECT = {
  orderNo: true,
  createdAt: true,
  customerName: true,
  customerPhone: true,
  note: true,
  subtotal: true,
  gstAmount: true,
  grandTotal: true,
  ratesSnapshot: true,
  ratesAt: true,
  voidedAt: true,
  items: {
    select: {
      name: true,
      metal: true,
      purity: true,
      weightMg: true,
      ratePerGram: true,
      makingPct: true,
      stoneCharge: true,
      gstPct: true,
      lineTotal: true,
      hallmarkNo: true,
      bisCertNo: true,
    },
  },
} as const;
