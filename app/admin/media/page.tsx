/**
 * /admin/media — every image on the site.
 * Created by Phase 7 (specs/07-admin-panel.md §7.6).
 *
 * §7.6: "This is what the client asked for repeatedly: every image on the site replaceable
 * from the dashboard."
 *
 * The slot list comes from `lib/media/slots.ts`, which is §7.6's table. A slot missing its
 * database row is created on first save, so the page works even if the seed has not run.
 */
import type { Metadata } from 'next';

import { MediaSlotCard } from '@/components/admin/media-slot-card';
import { Section } from '@/components/shell';
import { db } from '@/lib/db';
import { MEDIA_SLOTS } from '@/lib/media/slots';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Media' };

export default async function AdminMediaPage() {
  const rows = await db.mediaSlot.findMany();
  const bySlotKey = new Map(rows.map((row) => [row.slotKey, row]));

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Images</h1>
          <p className="text-body text-muted">
            Every picture on the site, in one place. Paste a link and press{' '}
            <strong>Check &amp; preview</strong> to see it at phone size before saving.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {MEDIA_SLOTS.map((slot) => {
            const row = bySlotKey.get(slot.key);
            return (
              <MediaSlotCard
                key={slot.key}
                slotKey={slot.key}
                label={slot.label}
                where={slot.where}
                recommended={slot.recommended}
                ratio={slot.ratio}
                supportsText={slot.supportsText}
                initial={{
                  imageUrl: row?.imageUrl ?? null,
                  linkUrl: row?.linkUrl ?? null,
                  headline: row?.headline ?? null,
                  subtext: row?.subtext ?? null,
                  isActive: row?.isActive ?? true,
                }}
              />
            );
          })}
        </div>
      </div>
    </Section>
  );
}
