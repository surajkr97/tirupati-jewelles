/**
 * Bill mutations.
 * Created by Phase 8 (specs/08-billing-whatsapp.md §8.4, §8.5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  §8.4: "After the admin returns from WhatsApp, show a `Mark as sent` confirmation → sets
 *  `sentViaWa` and `sentAt`. **Do not set it optimistically** — the admin may have
 *  cancelled, and a false 'sent' record is worse than no record."
 *
 *  So there is no code path that sets `sentViaWa` as a side effect of building a link.
 *  `markSent` is its own action, invoked by its own button, after the admin has been to
 *  WhatsApp and come back. The whole value of the flag is that it means something.
 *
 *  §8.5: "void (soft — never hard delete an invoice)". There is no delete in this file.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every action goes through `adminAction`, which re-checks the ADMIN role, rejects a
 * cross-origin request and writes the `AuditLog` entry §8 SECURITY requires ("Every bill
 * creation and send audited").
 */
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { adminAction, type ActionResult } from '@/lib/admin/actions';
import { generateBillPdf } from '@/lib/bills/create';
import { DASHBOARD_TOTALS_KEY } from '@/lib/bills/totals';
import { db } from '@/lib/db';
import { invalidate } from '@/lib/redis';

const idSchema = z.string().uuid();

async function revalidateBills(id?: string) {
  revalidatePath('/admin/bills');
  revalidatePath('/admin');
  if (id) revalidatePath(`/admin/bills/${id}`);
  // §8.7: "invalidate on new bill" — a void changes every total just as much as a sale.
  await invalidate(DASHBOARD_TOTALS_KEY);
}

/**
 * §8.4's "Mark as sent".
 *
 * Recording `sentAt` on every confirmation, including a resend, so the dashboard's "bills
 * sent this month" counts the most recent send rather than the first. The audit log keeps
 * the full history; the column keeps the latest.
 */
export async function markBillSent(input: unknown): Promise<ActionResult<undefined>> {
  return adminAction(async ({ audit }) => {
    const id = idSchema.safeParse(input);
    if (!id.success) return { ok: false, error: 'Unknown bill.' };

    const order = await db.order.findUnique({
      where: { id: id.data },
      select: { id: true, orderNo: true, sentViaWa: true, voidedAt: true },
    });
    if (!order) return { ok: false, error: 'That bill no longer exists.' };
    if (order.voidedAt) {
      return { ok: false, error: 'That bill is void. It cannot be marked as sent.' };
    }

    const sentAt = new Date();
    await db.order.update({
      where: { id: order.id },
      data: { sentViaWa: true, sentAt },
    });

    await audit({
      action: 'BILL_SEND',
      entity: 'Order',
      entityId: order.id,
      before: { sentViaWa: order.sentViaWa },
      after: { sentViaWa: true, sentAt: sentAt.toISOString(), channel: 'whatsapp' },
    });

    await revalidateBills(order.id);
    return { ok: true, data: undefined };
  });
}

/**
 * §8.5: "void (soft — never hard delete an invoice; note the legal retention requirement
 * in DEBT.md)".
 *
 * The invoice keeps its number and its PDF. It is excluded from every total (§8.7), stamped
 * VOID on reprint, and stays in the book — which is the point. Indian GST rules require
 * invoice records to be retained for six years from the annual return date (DEBT-026), so a
 * delete button here would be a compliance failure, not a convenience.
 */
export async function voidBill(input: unknown): Promise<ActionResult<undefined>> {
  return adminAction(async ({ admin, audit }) => {
    const parsed = z
      .object({
        id: idSchema,
        reason: z.string().min(3, 'Say why, in a few words.').max(200),
      })
      .safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Could not void that bill.',
        field: 'reason',
      };
    }

    const order = await db.order.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, orderNo: true, voidedAt: true, grandTotal: true },
    });
    if (!order) return { ok: false, error: 'That bill no longer exists.' };
    if (order.voidedAt) return { ok: false, error: 'That bill is already void.' };

    const voidedAt = new Date();
    await db.order.update({
      where: { id: order.id },
      data: { voidedAt, voidReason: parsed.data.reason.trim(), voidedByUserId: admin.id },
    });

    // Reprint carries the VOID stamp. The stored PDF is replaced rather than kept, because
    // a cancelled invoice that still prints clean is a document someone can present.
    await generateBillPdf(order.id);

    await audit({
      action: 'BILL_VOID',
      entity: 'Order',
      entityId: order.id,
      before: { voidedAt: null, grandTotal: order.grandTotal.toString() },
      after: { voidedAt: voidedAt.toISOString(), reason: parsed.data.reason.trim() },
    });

    await revalidateBills(order.id);
    return { ok: true, data: undefined };
  });
}

/**
 * Re-render an invoice.
 *
 * The retry path for a bill whose PDF render failed after the order committed — see
 * `createBill`'s note on why the render is deliberately outside the transaction. Also how
 * a bill picks up a corrected shop address or a newly uploaded logo.
 *
 * It does NOT re-price anything. The figures come from the snapshot on `OrderItem`, and
 * `buildBillData` refuses to print a bill whose stored total disagrees with them.
 */
export async function regenerateBillPdf(
  input: unknown,
): Promise<ActionResult<{ key: string }>> {
  return adminAction(async ({ audit }) => {
    const id = idSchema.safeParse(input);
    if (!id.success) return { ok: false, error: 'Unknown bill.' };

    const key = await generateBillPdf(id.data);
    if (!key) return { ok: false, error: 'That bill no longer exists.' };

    await audit({
      action: 'BILL_PDF_REGENERATE',
      entity: 'Order',
      entityId: id.data,
      after: { key },
    });

    await revalidateBills(id.data);
    return { ok: true, data: { key } };
  });
}
