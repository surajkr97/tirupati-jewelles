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
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CalculatorIsland } from '@/components/calculator/calculator-island';
import { Section } from '@/components/shell';
import { Skeleton } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Price calculator',
  description:
    'Price several pieces at once with today’s gold and silver rates, making charges and GST included.',
};

export default function CalculatorPage() {
  return (
    <Section className="pt-8 pb-0 md:pt-12">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-semibold tracking-tight text-ink md:text-h1-lg">
            Price calculator
          </h1>
          <p className="text-lead text-muted">
            Add each piece to get one total, with making charges and GST included.
          </p>
        </div>

        <Suspense fallback={<CalculatorSkeleton />}>
          <CalculatorIsland />
        </Suspense>
      </div>
    </Section>
  );
}

/** Matches the first item card's dimensions so nothing shifts when the island mounts. */
function CalculatorSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-[420px] w-full rounded-card" />
      <Skeleton className="h-control-lg w-full rounded-card" />
    </div>
  );
}
