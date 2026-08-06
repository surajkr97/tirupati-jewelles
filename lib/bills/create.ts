/**
 * Order creation — the server-authoritative bill.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §8.2: "**Recompute every line server-side.** The client's totals arrive but are
 *  discarded. This is not optional — it is the difference between a bill and a suggestion."
 *
 *  There is no total in the input type (`lib/bills/schema.ts` has no field for one and is
 *  `.strict()`), the rates are read from the database here, and every figure written to
 *  `Order` and `OrderItem` comes out of `lib/pricing.ts`. MASTER-SPEC's price-tampering
 *  control — "Client never sends a rate. Server reads rate from DB at request time and
 *  recomputes every total" — is enforced by there being nothing else to read.
 *
 *  ── The three things that must be inside one transaction ──
 *    1. The sequence increment (§8.2: concurrent bills must not collide).
 *    2. The order and its items.
 *    3. The audit entry.
 *  A number handed out by a transaction that then rolls back is a permanent gap in a
 *  legally numbered invoice series, so the counter is incremented on the transaction
 *  client and nowhere else.
 *
 *  The PDF is rendered AFTER the commit, deliberately. Rendering takes about a second, and
 *  holding the `BillSequence` row lock for that long would serialise the shop's till behind
 *  a PDF library. A render failure leaves an order with no `billPdfKey`, which the bill
 *  detail page can retry; a failed transaction would leave a hole in the numbering, which
 *  nothing can repair.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import 'server-only';

import { Metal, Prisma, Purity } from '@prisma/client';

import { mintClaimToken } from '@/lib/auth/claim-token';
import { formatOrderNo, nextSequence, shopYear } from '@/lib/bills/numbering';
import { ORDER_PDF_SELECT, renderBillPdf } from '@/lib/bills/render';
import type { CreateBillRequest } from '@/lib/bills/schema';
import {
  BILL_URL_TTL_SECONDS,
  newBillKey,
  replaceBillPdf,
  storeBillPdf,
} from '@/lib/bills/storage';
import { db } from '@/lib/db';
import { metalForPurity } from '@/lib/calculator/types';
import {
  calculateLine,
  gramsToMilligrams,
  rupeesToPaise,
  DEFAULT_GST_PCT,
  type LineInput,
  type PurityKey,
} from '@/lib/pricing';
import { getCurrentRates, newestEffectiveAt, toRatesByPurity } from '@/lib/rates';
import { invalidate } from '@/lib/redis';
import { DASHBOARD_TOTALS_KEY } from '@/lib/bills/totals';

export interface CreateBillContext {
  /** The ADMIN raising the bill — `Order.createdByUserId`. */
  adminId: string;
  ip?: string;
  /** E.164. Already normalised by the caller; §3 left an explicit note demanding it. */
  customerPhone: string;
  /** §8.2: "accept an `Idempotency-Key` header". */
  idempotencyKey?: string;
}

export type CreateBillResult =
  | { ok: true; orderId: string; orderNo: string; grandTotal: bigint; replayed: boolean }
  | { ok: false; error: string; field?: string };

/**
 * Convert one validated request item into engine input.
 *
 * The Zod schema already proved every field parses, so a throw here would be a programming
 * error rather than bad input — but `metal` is still derived from `purity` rather than
 * taken from the payload. Two fields that can disagree eventually will, and a
 * `GOLD`/`SILVER_999` pair prices at zero.
 */
function toLine(item: CreateBillRequest['items'][number]): LineInput {
  const purity = item.purity as PurityKey;

  return {
    metal: metalForPurity(purity),
    purity,
    weightMg: gramsToMilligrams(item.weightGrams),
    makingPct: item.makingPct.trim() === '' ? 0 : Number(item.makingPct),
    stoneCharge: item.stoneCharge.trim() === '' ? 0n : rupeesToPaise(item.stoneCharge),
    gstPct: item.gstPct.trim() === '' ? DEFAULT_GST_PCT : Number(item.gstPct),
  };
}

export async function createBill(
  request: CreateBillRequest,
  context: CreateBillContext,
): Promise<CreateBillResult> {
  /**
   * §8.2: "a repeated key returns the existing order rather than creating a duplicate.
   * Admins on flaky shop wifi will double-tap Generate."
   *
   * Checked here for the common case and enforced by the unique index below for the racing
   * one — two simultaneous requests with the same key both miss this read, and only one
   * survives the insert.
   */
  if (context.idempotencyKey) {
    const existing = await db.order.findUnique({
      where: { idempotencyKey: context.idempotencyKey },
      select: { id: true, orderNo: true, grandTotal: true },
    });
    if (existing) {
      return {
        ok: true,
        orderId: existing.id,
        orderNo: existing.orderNo,
        grandTotal: existing.grandTotal,
        replayed: true,
      };
    }
  }

  // The rate, read from the server at request time. Never from the request.
  const rates = await getCurrentRates();
  const byPurity = toRatesByPurity(rates);
  const ratesAt = newestEffectiveAt(rates);

  const lines = request.items.map(toLine);

  const missing = lines.find((line) => byPurity[line.purity] === 0n);
  if (missing) {
    // A zero rate would produce a bill for the making charge alone. Refuse rather than
    // print it.
    return {
      ok: false,
      error: `No rate has been set for ${missing.purity.replace('_', ' ')}. Set it before billing.`,
      field: 'items',
    };
  }

  let priced;
  try {
    priced = lines.map((line) => calculateLine(line, byPurity[line.purity]));
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Those figures could not be priced.',
      field: 'items',
    };
  }

  /**
   * §5.1: "grandTotal = sum of rounded lineTotals, so the bill's line items visibly add up
   * to its total." The same rule the calculator and the product page follow, because a
   * customer comparing the screen to the paper is the whole point of having one engine.
   */
  const subtotal = priced.reduce((sum, line) => sum + line.subtotal, 0n);
  const gstAmount = priced.reduce((sum, line) => sum + line.gstAmount, 0n);
  const grandTotal = priced.reduce((sum, line) => sum + line.lineTotal, 0n);

  /** §8.2: "Link to an existing user only if a user has that phone **and** `phoneVerified = true`." */
  const verifiedOwner = await db.user.findFirst({
    where: { phone: context.customerPhone, phoneVerified: true },
    select: { id: true },
  });

  const year = shopYear();
  const settings = await db.settings.findUnique({
    where: { id: 'singleton' },
    select: { billPrefix: true },
  });
  const prefix = settings?.billPrefix?.trim() || 'JW';

  let order: { id: string; orderNo: string };

  try {
    order = await db.$transaction(async (tx) => {
      const sequence = await nextSequence(tx, year);
      const orderNo = formatOrderNo(prefix, year, sequence);

      const created = await tx.order.create({
        data: {
          orderNo,
          userId: verifiedOwner?.id ?? null,
          customerPhone: context.customerPhone,
          customerName: request.customerName.trim() || null,
          note: request.note.trim() || null,
          subtotal,
          gstAmount,
          grandTotal,
          createdByUserId: context.adminId,
          idempotencyKey: context.idempotencyKey ?? null,
          ratesAt,
          /**
           * §8.3's rate reference block. Strings, because `Json` cannot hold a `bigint`
           * and a paise value silently downcast to a float is the one mistake MASTER-SPEC
           * §4 forbids outright.
           */
          ratesSnapshot: {
            K22_916: byPurity.K22_916.toString(),
            K18_750: byPurity.K18_750.toString(),
            SILVER_999: byPurity.SILVER_999.toString(),
          },
          items: {
            create: request.items.map((item, index) => {
              const line = lines[index]!;
              const result = priced[index]!;

              return {
                productId: item.productId ?? null,
                name: item.label.trim() || `Item ${index + 1}`,
                metal: line.metal as Metal,
                purity: line.purity as Purity,
                weightMg: line.weightMg,
                // §8.2: "Snapshot `ratePerGram`, `makingPct`, `gstPct` onto each
                // `OrderItem`. A bill reprinted in 2031 must show 2026's numbers."
                ratePerGram: byPurity[line.purity],
                makingPct: new Prisma.Decimal(line.makingPct),
                stoneCharge: line.stoneCharge,
                gstPct: new Prisma.Decimal(line.gstPct),
                lineTotal: result.lineTotal,
                hallmarkNo: item.hallmarkNo.trim() || null,
                bisCertNo: item.bisCertNo.trim() || null,
              };
            }),
          },
        },
        select: { id: true, orderNo: true },
      });

      /**
       * The possession proof, minted with the bill (DEBT-011).
       *
       * Only when the number is NOT already verified on an account: a customer whose
       * purchases already land in their history has nothing to claim, and a link that does
       * nothing is worse than no link.
       *
       * Inside the transaction, so a token can never outlive a rolled-back bill.
       */
      if (!verifiedOwner) {
        await mintClaimToken(context.customerPhone, created.id, tx);
      }

      // §8.2: "Write an `AuditLog` entry."
      await tx.auditLog.create({
        data: {
          actorId: context.adminId,
          action: 'ORDER_CREATE',
          entity: 'Order',
          entityId: created.id,
          after: {
            orderNo: created.orderNo,
            customerPhone: context.customerPhone,
            grandTotal: grandTotal.toString(),
            items: request.items.length,
            linkedUserId: verifiedOwner?.id ?? null,
          },
          ip: context.ip,
        },
      });

      return created;
    });
  } catch (err) {
    // The idempotency race: both requests missed the read, one lost the insert. The winner
    // has already written the order, so return it rather than reporting a conflict.
    if (
      context.idempotencyKey &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const existing = await db.order.findUnique({
        where: { idempotencyKey: context.idempotencyKey },
        select: { id: true, orderNo: true, grandTotal: true },
      });
      if (existing) {
        return {
          ok: true,
          orderId: existing.id,
          orderNo: existing.orderNo,
          grandTotal: existing.grandTotal,
          replayed: true,
        };
      }
    }
    throw err;
  }

  await generateBillPdf(order.id);
  // §8.7: "Cache in Redis 60s; invalidate on new bill."
  await invalidate(DASHBOARD_TOTALS_KEY);

  return {
    ok: true,
    orderId: order.id,
    orderNo: order.orderNo,
    grandTotal,
    replayed: false,
  };
}

/**
 * Render and store an order's PDF, then point the order at it.
 *
 * Separate from `createBill` because it is also the retry path: a bill whose render failed
 * has an order and no `billPdfKey`, and the detail screen regenerates it without creating a
 * second invoice. Idempotent — an order that already has a key keeps it.
 */
export async function generateBillPdf(orderId: string): Promise<string | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { ...ORDER_PDF_SELECT, billPdfKey: true },
  });
  if (!order) return null;

  const key = order.billPdfKey ?? newBillKey();
  const expiresAt = new Date(Date.now() + BILL_URL_TTL_SECONDS * 1000);

  const bytes = await renderBillPdf(order);

  if (order.billPdfKey) {
    await replaceBillPdf(orderId, key, bytes, expiresAt);
  } else {
    await storeBillPdf(orderId, key, bytes, expiresAt);
    await db.order.update({ where: { id: orderId }, data: { billPdfKey: key } });
  }

  return key;
}
