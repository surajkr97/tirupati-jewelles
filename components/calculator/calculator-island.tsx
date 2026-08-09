/**
 * Client entry point for the calculator.
 * Created by Phase 5 (specs/05-calculator.md §5.4, §5.6).
 *
 * Exists so `useSearchParams` — the §5.6 preload — stays on the client. Reading the query
 * string in the page's server component would make `/calculator` render per request, and
 * MASTER-SPEC §6 specifies "CSR in a static shell". The page wraps this in `<Suspense>`,
 * which is what lets the shell stay prerendered.
 */
'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { Calculator } from '@/components/calculator/calculator';
import { preloadedItemFromParams } from '@/lib/calculator/preload';
import type { ItemDefaults } from '@/lib/calculator/types';

export function CalculatorIsland({ defaults }: { defaults: ItemDefaults }) {
  const searchParams = useSearchParams();

  const preloaded = useMemo(
    // A fixed id: this item is created once, from the URL, and never needs to be
    // distinguished from another preloaded one.
    () =>
      preloadedItemFromParams(
        new URLSearchParams(searchParams.toString()),
        'preloaded',
        defaults,
      ),
    [searchParams, defaults],
  );

  return (
    <Calculator initialItems={preloaded ? [preloaded] : undefined} defaults={defaults} />
  );
}
