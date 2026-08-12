/**
 * /admin/settings.
 * Created by Phase 7 (specs/07-admin-panel.md §7.9), restyled by Stage 5F.
 *
 * The "← More" back link that pointed at `/admin/media` is gone — see the note in
 * `app/admin/categories/page.tsx`; all three of this stage's pages carried the same one.
 */
import type { Metadata } from 'next';

import { SettingsForm } from '@/components/admin/settings-form';
import { Section } from '@/components/shell';
import { db } from '@/lib/db';
import { clientEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Settings' };

export default async function AdminSettingsPage() {
  const settings = await db.settings.findUnique({ where: { id: 'singleton' } });

  return (
    <Section className="pt-6 pb-0">
      {/* §20 — an editing column, the same measure the rest of the admin's forms use. */}
      <div className="flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Settings</h1>
          <p className="text-body text-muted">
            What appears on your invoices, what customers are charged by default, and how
            they reach you. Saving asks for your password.
          </p>
        </div>

        <SettingsForm
          envJitter={clientEnv.NEXT_PUBLIC_TICKER_JITTER}
          /**
           * §7 — which of these have never been written.
           *
           * `ownerWhatsApp` is the one that matters: it falls back to
           * `NEXT_PUBLIC_OWNER_WA`, so the form has always shown a real, working number
           * that was not in the database, with nothing to distinguish it from a configured
           * one. The others are nullable columns whose empty string reads identically to
           * "deliberately blank".
           */
          unset={{
            gstin: !settings?.gstin,
            ownerWhatsApp: !settings?.ownerWhatsApp,
            address: !settings?.address,
          }}
          initial={{
            shopName: settings?.shopName ?? 'Tirupati Jewelles',
            address: settings?.address ?? '',
            gstin: settings?.gstin ?? '',
            contactPhone: settings?.contactPhone ?? '',
            ownerWhatsApp: settings?.ownerWhatsApp ?? clientEnv.NEXT_PUBLIC_OWNER_WA,
            defaultGstPct: settings?.defaultGstPct.toString() ?? '3',
            defaultMakingPct: settings?.defaultMakingPct.toString() ?? '12',
            billPrefix: settings?.billPrefix ?? 'JW',
            /**
             * A string, not a number.
             *
             * The field held `Number(e.target.value) || 1`, so clearing it to retype snapped
             * straight back to "1" and there was no way to get from 41 to 402 without going
             * through 4021 or 1. The schema is `z.coerce.number()`, so the string coerces on
             * the server exactly as before — this changes the keyboard experience, not what
             * is stored or what is accepted.
             */
            billSequence: String(settings?.billSequence ?? 1),
            tickerJitter:
              settings?.tickerJitter === null || settings?.tickerJitter === undefined
                ? 'default'
                : settings.tickerJitter
                  ? 'on'
                  : 'off',
            businessHours: settings?.businessHours ?? '',
            holidayNotice: settings?.holidayNotice ?? '',
          }}
        />
      </div>
    </Section>
  );
}
