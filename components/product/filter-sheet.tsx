/**
 * Catalogue filters.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.1).
 *
 * §6.1: "On mobile, filters open in a bottom `Sheet` with an apply button. Never a sidebar
 * squeezed onto a phone."
 *
 * The apply button is not decoration. Filters navigate — each change is a new URL and a
 * server round trip — so applying on every tap would fire a navigation per keystroke of
 * thought. Choices are held locally and committed once, which is also what makes "Clear
 * all" a single action rather than four.
 */
'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge, Button, Sheet } from '@/components/ui';
import {
  activeFilterCount,
  filtersToQuery,
  PRICE_BANDS,
  PURITY_FILTERS,
  SORT_OPTIONS,
  WEIGHT_BANDS,
  type CatalogFilters,
  type PurityToken,
  type SortToken,
} from '@/lib/catalog/filters';
import { cn } from '@/lib/utils/cn';

interface Draft {
  purityToken: PurityToken | null;
  priceToken: string | null;
  weightToken: string | null;
  sort: SortToken;
}

export function FilterSheet({
  basePath,
  filters,
  resultCount,
}: {
  /** e.g. `/collections/rings`. Filters are query params on top of it. */
  basePath: string;
  filters: CatalogFilters;
  resultCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [draft, setDraft] = useState<Draft>({
    purityToken: filters.purityToken,
    priceToken: filters.price?.token ?? null,
    weightToken: filters.weight?.token ?? null,
    sort: filters.sort,
  });

  const activeCount = activeFilterCount(filters);

  const apply = () => {
    const query = filtersToQuery({
      purityToken: draft.purityToken,
      price: PRICE_BANDS.find((b) => b.token === draft.priceToken),
      weight: WEIGHT_BANDS.find((b) => b.token === draft.weightToken),
      sort: draft.sort,
      // Applying a filter always returns to the first page. Staying on page 3 of a set
      // that now has one page shows an empty grid and reads as "no results".
      page: 1,
    });

    setOpen(false);
    router.push(`${basePath}${query}`);
  };

  const clear = () => {
    setDraft({ purityToken: null, priceToken: null, weightToken: null, sort: 'newest' });
    setOpen(false);
    router.push(basePath);
  };

  // Reset the draft to the applied state whenever the sheet opens, so abandoning it and
  // reopening does not resurrect choices that were never applied.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft({
        purityToken: filters.purityToken,
        priceToken: filters.price?.token ?? null,
        weightToken: filters.weight?.token ?? null,
        sort: filters.sort,
      });
    }
    setOpen(next);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <p className="text-small text-muted" aria-live="polite">
          {resultCount} {resultCount === 1 ? 'piece' : 'pieces'}
        </p>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenChange(true)}
          data-testid="open-filters"
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filter &amp; sort
          {activeCount > 0 && <Badge>{activeCount}</Badge>}
        </Button>
      </div>

      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title="Filter & sort"
        description="Choose what you would like to see, then apply."
      >
        <div className="flex flex-col gap-8">
          <Group label="Metal & purity">
            <Chip
              label="All"
              selected={draft.purityToken === null}
              onClick={() => setDraft((d) => ({ ...d, purityToken: null }))}
            />
            {PURITY_FILTERS.map((option) => (
              <Chip
                key={option.token}
                label={option.label}
                selected={draft.purityToken === option.token}
                onClick={() => setDraft((d) => ({ ...d, purityToken: option.token }))}
              />
            ))}
          </Group>

          <Group label="Price">
            <Chip
              label="Any"
              selected={draft.priceToken === null}
              onClick={() => setDraft((d) => ({ ...d, priceToken: null }))}
            />
            {PRICE_BANDS.map((band) => (
              <Chip
                key={band.token}
                label={band.label}
                selected={draft.priceToken === band.token}
                onClick={() => setDraft((d) => ({ ...d, priceToken: band.token }))}
              />
            ))}
          </Group>

          <Group label="Weight">
            <Chip
              label="Any"
              selected={draft.weightToken === null}
              onClick={() => setDraft((d) => ({ ...d, weightToken: null }))}
            />
            {WEIGHT_BANDS.map((band) => (
              <Chip
                key={band.token}
                label={band.label}
                selected={draft.weightToken === band.token}
                onClick={() => setDraft((d) => ({ ...d, weightToken: band.token }))}
              />
            ))}
          </Group>

          <Group label="Sort by">
            {SORT_OPTIONS.map((option) => (
              <Chip
                key={option.token}
                label={option.label}
                selected={draft.sort === option.token}
                onClick={() => setDraft((d) => ({ ...d, sort: option.token }))}
              />
            ))}
          </Group>

          <div className="flex gap-4">
            <Button variant="ghost" size="md" onClick={clear} className="flex-1">
              Clear all
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={apply}
              className="flex-1"
              data-testid="apply-filters"
            >
              Apply
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-small font-semibold text-ink">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'h-tap rounded-pill px-4 text-small font-medium',
        'transition-colors duration-fast ease-standard',
        'focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none',
        selected ? 'bg-ink text-white' : 'bg-rose-tint text-ink hover:bg-rose/15',
      )}
    >
      {label}
    </button>
  );
}
