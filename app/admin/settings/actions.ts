/**
 * Settings mutations.
 * Created by Phase 7 (specs/07-admin-panel.md §7.9).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Settings changes require the admin's password again.
 *
 *  §7 SECURITY: "Admin session shorter than customer (8h) and re-auth required for settings
 *  changes." The Phase 7 design review carried this as constraint 4 and gave the reason:
 *  settings hold the WhatsApp number every bill is sent from and the GSTIN printed on
 *  invoices. An unattended-laptop takeover of those is worth considerably more than a rate
 *  change, which is already guarded by its own confirmation step.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { adminAction, type ActionResult } from '@/lib/admin/actions';
import { verifyPassword } from '@/lib/auth/argon2';
import { db } from '@/lib/db';

/**
 * The one settings row.
 *
 * A plain const, NOT exported: a `'use server'` file may only export async functions, and
 * exporting this broke the whole module graph — every admin page that transitively reached
 * it 500'd, including `/admin/audit`, which does not use settings at all. The symptom was
 * a long way from the cause.
 */
const SETTINGS_ID = 'singleton';

const schema = z.object({
  password: z.string().min(1, 'Enter your password to save changes.'),
  shopName: z.string().min(1, 'Shop name is required.').max(120),
  address: z.string().max(400),
  gstin: z.string().max(20),
  contactPhone: z.string().max(20),
  ownerWhatsApp: z.string().max(20),
  defaultGstPct: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'GST must be a percentage.')
    .refine((v) => Number(v) <= 100, 'GST must be 0–100.'),
  defaultMakingPct: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Making charge must be a percentage.')
    .refine((v) => Number(v) <= 100, 'Making charge must be 0–100.'),
  billPrefix: z.string().min(1).max(8),
  billSequence: z.coerce.number().int().min(1).max(9_999_999),
  /** null = follow the env flag; true/false override it (§7.9). */
  tickerJitter: z.enum(['default', 'on', 'off']),
  businessHours: z.string().max(200),
  holidayNotice: z.string().max(300),
});

export async function saveSettings(input: unknown): Promise<ActionResult<undefined>> {
  return adminAction(async ({ admin, audit }) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        error: issue?.message ?? 'Check the highlighted fields.',
        field: issue?.path.join('.'),
      };
    }

    const data = parsed.data;

    /**
     * Re-authentication.
     *
     * The password is fetched with an explicit select — `PUBLIC_USER_SELECT` deliberately
     * excludes it — and compared with the same Argon2id parameters everything else uses.
     * A wrong password is a generic failure, not "wrong password for admin@…": this is
     * still an authentication response and §3's enumeration rule applies.
     */
    const account = await db.user.findUnique({
      where: { id: admin.id },
      select: { passwordHash: true },
    });

    if (!account?.passwordHash) {
      return {
        ok: false,
        error: 'This account has no password set, so settings cannot be changed.',
        field: 'password',
      };
    }

    const correct = await verifyPassword(account.passwordHash, data.password);
    if (!correct) {
      return { ok: false, error: 'That password did not match.', field: 'password' };
    }

    const before = await db.settings.findUnique({ where: { id: SETTINGS_ID } });

    const values = {
      shopName: data.shopName.trim(),
      address: data.address.trim() || null,
      gstin: data.gstin.trim().toUpperCase() || null,
      contactPhone: data.contactPhone.trim() || null,
      ownerWhatsApp: data.ownerWhatsApp.replace(/\D/g, '') || null,
      defaultGstPct: data.defaultGstPct,
      defaultMakingPct: data.defaultMakingPct,
      billPrefix: data.billPrefix.trim().toUpperCase(),
      billSequence: data.billSequence,
      tickerJitter: data.tickerJitter === 'default' ? null : data.tickerJitter === 'on',
      businessHours: data.businessHours.trim() || null,
      holidayNotice: data.holidayNotice.trim() || null,
    };

    await db.settings.upsert({
      where: { id: SETTINGS_ID },
      update: values,
      create: { id: SETTINGS_ID, ...values },
    });

    /**
     * The password is never in the audit entry, and neither is anything derived from it.
     * `before`/`after` record the settings, which is what an auditor needs.
     */
    await audit({
      action: 'SETTINGS_UPDATE',
      entity: 'Settings',
      entityId: SETTINGS_ID,
      before: before
        ? {
            shopName: before.shopName,
            gstin: before.gstin,
            ownerWhatsApp: before.ownerWhatsApp,
            billPrefix: before.billPrefix,
            billSequence: before.billSequence,
            tickerJitter: before.tickerJitter,
          }
        : null,
      after: {
        shopName: values.shopName,
        gstin: values.gstin,
        ownerWhatsApp: values.ownerWhatsApp,
        billPrefix: values.billPrefix,
        billSequence: values.billSequence,
        tickerJitter: values.tickerJitter,
      },
    });

    // The jitter toggle and the holiday notice both show on the storefront.
    revalidatePath('/');

    return { ok: true, data: undefined };
  });
}
