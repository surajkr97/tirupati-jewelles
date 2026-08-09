/**
 * Search input.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.4) — "Debounced 300ms".
 *
 * The debounce is on the NAVIGATION, not on a fetch. Results are server-rendered from the
 * URL, so every keystroke would otherwise be a round trip and a history entry — and the
 * back button would walk back through "n", "ne", "nec", "neck".
 *
 * `router.replace`, not `push`, for the same reason: typing a query is one act of
 * navigation, so back should leave the search page rather than rewind the typing.
 */
'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export const SEARCH_DEBOUNCE_MS = 300;

export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  // Skip the navigation on first render — the page already reflects `initialQuery`, and
  // replacing the URL with what it already is would be a wasted round trip on every load.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }

    const timer = setTimeout(() => {
      const trimmed = value.trim();
      router.replace(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search');
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value, router]);

  return (
    <div className="relative flex items-center">
      <Search
        className="pointer-events-none absolute left-4 size-icon text-muted"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search rings, necklaces, silver…"
        aria-label="Search the catalogue"
        maxLength={80}
        // `search` type gives the keyboard a "Search" key and a native clear affordance on
        // iOS; `autoFocus` is deliberately absent, because a keyboard covering the results
        // on arrival is worse than one extra tap.
        className="h-control-lg w-full rounded-pill bg-white pr-4 pl-12 text-body text-ink ring-1 ring-line ring-inset placeholder:text-muted focus:ring-2 focus:ring-ink focus:outline-none"
        data-testid="search-input"
      />
    </div>
  );
}
