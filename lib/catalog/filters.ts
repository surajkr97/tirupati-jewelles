/**
 * Catalogue filters, as URL state.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.1).
 *
 * §6.1: "Filters live in the URL (`?purity=22k&sort=price_asc`) so a filtered view is
 * shareable and back-button-correct."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERY FILTER VALUE IS AN ALLOWLISTED TOKEN.
 *
 *  §6 SECURITY: "Filter params validated against an allowlist; an unexpected sort value
 *  falls back to default rather than reaching the query builder."
 *
 *  Bands are named (`price=25000-50000`) rather than free numeric ranges. That is partly a
 *  mobile-usability choice — tapping a band beats typing two numbers — but it also means
 *  there is no arithmetic anywhere between the query string and the query: a value either
 *  IS one of five known strings or it is dropped. Nothing user-supplied is ever
 *  interpolated, parsed into a number that reaches SQL, or used to build an `orderBy`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Client-safe: no `server-only`, no Prisma import. The filter Sheet is a client component
 * and builds the same URLs this module parses.
 */
import type { PurityKey } from '@/lib/pricing';

// ── Purity ─────────────────────────────────────────────────────────────────

/** URL token → domain purity. The token is what a shopper sees; the key is what we store. */
export const PURITY_FILTERS = [
  { token: '22k', purity: 'K22_916', label: 'Gold 22K' },
  { token: '18k', purity: 'K18_750', label: 'Gold 18K' },
  { token: 'silver', purity: 'SILVER_999', label: 'Silver 999' },
] as const satisfies readonly { token: string; purity: PurityKey; label: string }[];

export type PurityToken = (typeof PURITY_FILTERS)[number]['token'];

// ── Bands ──────────────────────────────────────────────────────────────────

export interface Band {
  token: string;
  label: string;
  /** Inclusive lower bound. */
  min: bigint | null;
  /** Exclusive upper bound. `null` means unbounded. */
  max: bigint | null;
}

/** Price bands in PAISE. The labels are the rupee figures a shopper recognises. */
export const PRICE_BANDS = [
  { token: 'under-25000', label: 'Under ₹25,000', min: null, max: 2_500_000n },
  { token: '25000-50000', label: '₹25,000 – ₹50,000', min: 2_500_000n, max: 5_000_000n },
  {
    token: '50000-100000',
    label: '₹50,000 – ₹1,00,000',
    min: 5_000_000n,
    max: 10_000_000n,
  },
  {
    token: '100000-250000',
    label: '₹1,00,000 – ₹2,50,000',
    min: 10_000_000n,
    max: 25_000_000n,
  },
  { token: 'over-250000', label: 'Over ₹2,50,000', min: 25_000_000n, max: null },
] as const satisfies readonly Band[];

/** Weight bands in MILLIGRAMS, the unit the schema stores. */
export const WEIGHT_BANDS = [
  { token: 'under-5', label: 'Under 5 g', min: null, max: 5_000n },
  { token: '5-15', label: '5 – 15 g', min: 5_000n, max: 15_000n },
  { token: '15-30', label: '15 – 30 g', min: 15_000n, max: 30_000n },
  { token: '30-50', label: '30 – 50 g', min: 30_000n, max: 50_000n },
  { token: 'over-50', label: 'Over 50 g', min: 50_000n, max: null },
] as const satisfies readonly Band[];

// ── Sort ───────────────────────────────────────────────────────────────────

export const SORT_OPTIONS = [
  { token: 'newest', label: 'Newest first' },
  { token: 'price_asc', label: 'Price: low to high' },
  { token: 'price_desc', label: 'Price: high to low' },
  { token: 'weight_asc', label: 'Weight: light to heavy' },
  { token: 'weight_desc', label: 'Weight: heavy to light' },
] as const;

export type SortToken = (typeof SORT_OPTIONS)[number]['token'];

export const DEFAULT_SORT: SortToken = 'newest';

/** §6.1: "Pagination: 24 per page". */
export const PAGE_SIZE = 24;

// ── Parsed shape ───────────────────────────────────────────────────────────

export interface CatalogFilters {
  purity: PurityKey | null;
  purityToken: PurityToken | null;
  price: Band | null;
  weight: Band | null;
  sort: SortToken;
  /** 1-based. "Load more" raises this rather than replacing the list. */
  page: number;
}

export const EMPTY_FILTERS: CatalogFilters = {
  purity: null,
  purityToken: null,
  price: null,
  weight: null,
  sort: DEFAULT_SORT,
  page: 1,
};

/** Anything not on the list is dropped — never rejected, never passed through. */
function pick<T extends { token: string }>(
  options: readonly T[],
  value: string | undefined,
): T | null {
  if (!value) return null;
  return options.find((option) => option.token === value) ?? null;
}

/**
 * Read one query parameter, ignoring the repeated `?a=1&a=2` form.
 *
 * Next hands back `string[]` for repeats. Taking the first would let an attacker append a
 * benign value to smuggle something past a naive check; dropping the whole parameter is the
 * unambiguous choice, and no legitimate link repeats a filter.
 */
function one(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Parse a query string into filters.
 *
 * Never throws and never rejects. A malformed filter yields the unfiltered view rather than
 * an error page — a shopper who followed a stale link should see products, not a 400.
 */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): CatalogFilters {
  const purityFilter = pick(PURITY_FILTERS, one(params, 'purity'));
  const sortOption = pick(SORT_OPTIONS, one(params, 'sort'));

  // A malformed `page` becomes 1. `Number()` on 'abc' is NaN, which would otherwise flow
  // into a `skip` and make Prisma throw.
  const rawPage = Number(one(params, 'page'));
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100 ? rawPage : 1;

  return {
    purity: purityFilter?.purity ?? null,
    purityToken: purityFilter?.token ?? null,
    price: pick(PRICE_BANDS, one(params, 'price')),
    weight: pick(WEIGHT_BANDS, one(params, 'weight')),
    // The §6 SECURITY case, spelled out: an unrecognised sort becomes the default and
    // never reaches an `orderBy`.
    sort: sortOption?.token ?? DEFAULT_SORT,
    page,
  };
}

/**
 * Serialise filters back to a query string.
 *
 * Defaults are omitted so a URL only carries what the shopper actually chose — `/collections/rings`
 * rather than `/collections/rings?sort=newest&page=1`, which reads as a filtered view when
 * it is not.
 */
export function filtersToQuery(filters: Partial<CatalogFilters>): string {
  const params = new URLSearchParams();

  if (filters.purityToken) params.set('purity', filters.purityToken);
  if (filters.price) params.set('price', filters.price.token);
  if (filters.weight) params.set('weight', filters.weight.token);
  if (filters.sort && filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));

  const query = params.toString();
  return query ? `?${query}` : '';
}

/** How many filters are active — the badge on the mobile filter button. */
export function activeFilterCount(filters: CatalogFilters): number {
  return [filters.purity, filters.price, filters.weight].filter(Boolean).length;
}

export function hasActiveFilters(filters: CatalogFilters): boolean {
  return activeFilterCount(filters) > 0 || filters.sort !== DEFAULT_SORT;
}
