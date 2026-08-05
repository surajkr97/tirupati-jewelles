/**
 * /admin/settings.
 * Created by Phase 7 (specs/07-admin-panel.md §7.9).
 */
import type { Metadata } from 'next';
import Link from 'next/link';

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
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link href="/admin/media" className="text-small font-medium text-taupe-deep">
            ← More
          </Link>
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Settings</h1>
        </div>

        <SettingsForm
          envJitter={clientEnv.NEXT_PUBLIC_TICKER_JITTER}
          initial={{
            shopName: settings?.shopName ?? 'Tirupati Jewelles',
            address: settings?.address ?? '',
            gstin: settings?.gstin ?? '',
            contactPhone: settings?.contactPhone ?? '',
            ownerWhatsApp: settings?.ownerWhatsApp ?? clientEnv.NEXT_PUBLIC_OWNER_WA,
            defaultGstPct: settings?.defaultGstPct.toString() ?? '3',
            defaultMakingPct: settings?.defaultMakingPct.toString() ?? '12',
            billPrefix: settings?.billPrefix ?? 'JW',
            billSequence: settings?.billSequence ?? 1,
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
