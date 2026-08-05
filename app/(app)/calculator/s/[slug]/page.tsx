/**
 * /calculator/s/[slug] — a shared price estimate.
 * Created by Phase 5 (specs/05-calculator.md §5.5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  SSR, and priced from the rates SNAPSHOTTED at share time.
 *
 *  §5.5: "recomputes with rates snapshotted at share time, so a shared link doesn't
 *  silently change price." Gold moves daily. A quote sent on Monday and opened on Friday
 *  must still say what it said, or the shop looks careless at best.
 *
 *  Recomputed, not read back: the stored row holds items and rates, never a total. The
 *  same `lib/pricing.ts` that priced it on the client prices it again here, which is what
 *  makes "one implementation" worth having.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SharedEstimate } from '@/components/calculator/shared-estimate';
import { Section } from '@/components/shell';
import { readShare } from '@/lib/calculator/share';
import { toLineInput } from '@/lib/calculator/types';
import { formatShopDateTime } from '@/lib/datetime';
import { calculateTotal, type LineInput } from '@/lib/pricing';

/** Per-link and time-sensitive; never cached (MASTER-SPEC §6). */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared price estimate',
  // A shared link is meant for one recipient. Keeping it out of search results is the same
  // instinct MASTER-SPEC applies to bill PDFs.
  robots: { index: false, follow: false },
};

export default async function SharedCalculationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Next 16 made route params async (D-002).
  const { slug } = await params;
  const share = await readShare(slug);

  // Expired and never-existed are the same 404 — see `readShare` for why.
  if (!share) notFound();

  const inputs: LineInput[] = [];
  for (const item of share.items) {
    const converted = toLineInput(item);
    // Stored items were validated on write and re-validated on read; a row that still
    // fails to convert is corrupt rather than merely old.
    if (converted.ok) inputs.push(converted.input);
  }

  const total = calculateTotal(inputs, share.rates);

  return (
    <Section className="pt-8 md:pt-12">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-semibold tracking-tight text-ink md:text-h1-lg">
            Price estimate
          </h1>
          {/* §5.5: "Show the snapshot date." Without it the reader cannot tell whether
              they are looking at today's price or last month's. */}
          <p className="text-lead text-muted">
            Priced with rates as of{' '}
            <time dateTime={share.ratesAt.toISOString()} className="font-medium text-ink">
              {formatShopDateTime(share.ratesAt)}
            </time>
          </p>
        </div>

        <SharedEstimate items={share.items} total={total} />

        <p className="text-small text-muted">
          Indicative rate · This estimate keeps the rates it was created with · Final
          price confirmed in store.
        </p>

        <Link
          href="/calculator"
          className="inline-flex h-control items-center justify-center self-start rounded-pill bg-ink px-6 text-body font-semibold text-white transition-transform duration-fast ease-standard active:scale-[0.98]"
        >
          Price your own pieces
        </Link>
      </div>
    </Section>
  );
}
