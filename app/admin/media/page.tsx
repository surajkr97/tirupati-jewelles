/**
 * /admin/media — every image on the site.
 * Created by Phase 7 (specs/07-admin-panel.md §7.6), regrouped by Stage 5D (§15).
 *
 * §7.6: "This is what the client asked for repeatedly: every image on the site replaceable
 * from the dashboard."
 *
 * The slot list comes from `lib/media/slots.ts`, which is §7.6's table. A slot missing its
 * database row is created on first save, so the page works even if the seed has not run.
 *
 * ── Two groups, because two is the honest number ──
 *
 * §7.6 planned eleven surfaces and the application renders two of them: the homepage hero
 * and the invoice logo. The other ten accept an upload, audit it, store it and show it to
 * nobody — and the page used to promise each one a specific place on the site, including an
 * about page that does not exist.
 *
 * Splitting the list is the smallest truthful fix. Nothing is removed: the slots are seeded,
 * an owner may already have filled some, and dropping a row is a schema decision rather than
 * a redesign one. See `SlotDefinition.live` and UI_REDESIGN_DEBT-011.
 */
import type { Metadata } from 'next';

import { MediaSlotCard } from '@/components/admin/media-slot-card';
import { Section } from '@/components/shell';
import { db } from '@/lib/db';
import { MEDIA_SLOTS } from '@/lib/media/slots';

import type { SlotDefinition } from '@/lib/media/slots';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Media' };

export default async function AdminMediaPage() {
  const rows = await db.mediaSlot.findMany();
  const bySlotKey = new Map(rows.map((row) => [row.slotKey, row]));

  const live = MEDIA_SLOTS.filter((slot) => slot.live);
  const dormant = MEDIA_SLOTS.filter((slot) => !slot.live);

  const card = (slot: SlotDefinition) => {
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
        live={slot.live}
        initial={{
          imageUrl: row?.imageUrl ?? null,
          linkUrl: row?.linkUrl ?? null,
          headline: row?.headline ?? null,
          subtext: row?.subtext ?? null,
          isActive: row?.isActive ?? true,
        }}
      />
    );
  };

  return (
    <Section className="pt-6 pb-0">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-tight text-ink">Images</h1>
          <p className="text-body text-muted">
            Paste a link and press <strong>Check &amp; preview</strong> to see it at phone
            size before saving.
          </p>
        </div>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-h3 font-semibold text-ink">On the site now</h2>
            <p className="text-small text-muted">
              Changing one of these changes what a customer sees.
            </p>
          </div>
          {/*
            §7 — two columns from `lg`. The preview inside each card is capped at phone
            width regardless, so a wider card would only add empty space beside it.
          */}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {live.map(card)}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-h3 font-semibold text-ink">Not shown anywhere yet</h2>
            <p className="text-small text-muted">
              These slots exist and will keep whatever you put in them, but nothing on the
              site or on a bill reads them today. Worth knowing before you spend an
              afternoon on photographs.
            </p>
          </div>
          {/* `items-start` — a slot with a headline and a link is twice the height of one
              without, and stretching the short card to match just adds white space. */}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {dormant.map(card)}
          </div>
        </section>
      </div>
    </Section>
  );
}
