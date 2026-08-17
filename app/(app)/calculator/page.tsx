/**
 * /calculator — flagship feature #2.
 * Created by Phase 5 (specs/05-calculator.md §5.4).
 *
 * A static shell around a CSR island (MASTER-SPEC §6): "Pure interaction; rates fetched
 * once on mount." Nothing on this page is per-user or time-sensitive, so the HTML is
 * prerendered and only the calculator itself runs on the client.
 *
 * The `<Suspense>` boundary is load-bearing rather than decorative: `CalculatorIsland`
 * calls `useSearchParams` for the §5.6 preload, and without a boundary that would opt the
 * whole route out of prerendering — turning the static shell this section specifies into a
 * per-request render.
 *
 * Phase 9 (DEBT-024) made the page read the shop's §7.9 pricing defaults. That is a server
 * read, so the shell now revalidates on the same 300s window as every other price surface
 * rather than being prerendered once at build; `SETTINGS_SURFACES` in `lib/settings.ts`
 * refreshes it immediately when the owner changes a default. The shell is still static HTML
 * around a client island — the §6 requirement is unchanged.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CalculatorIsland } from '@/components/calculator/calculator-island';
import { Section } from '@/components/shell';
import { Skeleton } from '@/components/ui';
import { getPricingDefaults } from '@/lib/settings';
import { canonical } from '@/lib/seo';

export const revalidate = 300;

export const metadata: Metadata = {
  ...canonical('/calculator'),
  title: 'Price calculator',
  description:
    'Price several pieces at once with today’s gold and silver rates, making charges and GST included.',
};

export default async function CalculatorPage() {
  const defaults = await getPricingDefaults();

  return (
    <Section className="pt-8 pb-0 md:pt-12">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-h1 font-medium tracking-tight text-ink md:text-h1-lg">
            Price calculator
          </h1>
          <p className="text-lead text-muted">
            Add each piece to get one total, with making charges and GST included.
          </p>
        </div>

        <Suspense fallback={<CalculatorSkeleton />}>
          <CalculatorIsland defaults={defaults} />
        </Suspense>
      </div>
    </Section>
  );
}

/**
 * Matches the first item card's dimensions so nothing shifts when the island mounts.
 *
 * The height is measured, and the flat 420px it replaces was wrong in both directions before
 * Stage 7 ever touched it: the card renders 399px at 390px and 469px from `md`, so the
 * skeleton was 21px too tall on a phone and 49px too short on a desktop — a visible jump on
 * every calculator load, in the one place the design gallery states the rule outright
 * ("Skeleton — must match final dimensions exactly").
 *
 * Ramped on the same 390 → 768 interpolation as the tokens, so it tracks the card it stands
 * in for instead of being a number that was right once.
 *
 * The `max-[364px]` branch is the card's own reflow, not a guess at one. Below 365px its
 * field rows wrap and it jumps to a flat 451px — measured by walking the width in 5px steps,
 * because a discrete reflow is exactly the thing a linear ramp cannot model and the ramp
 * alone under-reserved by 52px at 320px. Above it, the ramp is exact at both ends.
 *
 * Verified with JavaScript disabled, which is the only way to hold a Suspense fallback on
 * screen long enough to measure it: 0px shift at 365, 390, 768 and 1280px.
 */
function CalculatorSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-[clamp(399px,326.7775px+18.5186vw,469px)] max-[364px]:h-[451px] w-full rounded-card" />
      <Skeleton className="h-control-lg w-full rounded-card" />
    </div>
  );
}
