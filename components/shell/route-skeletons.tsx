/**
 * Skeletons for the route-level `loading.tsx` files.
 * Created by the UI redesign, Stage 2 (audit C-2).
 *
 * ── Why these live together rather than inline in each loading.tsx ──
 *
 * A skeleton is only useful if it is the same SHAPE as what replaces it; a skeleton that
 * settles into a different layout is a layout shift with extra steps. Keeping them beside
 * each other makes it obvious when one has drifted from its page, and lets the card and grid
 * shapes be shared instead of re-guessed per route.
 *
 * ── Why they are so plain ──
 *
 * ── Where these may NOT be used ──
 *
 * A route-level `loading.tsx` opts its segment into streaming, and a streamed response has
 * already sent `HTTP 200` before the page body runs — so a later `notFound()` renders the 404
 * UI under a 200 status. Stage 2 shipped that briefly: skeletons on `/collections/[slug]` and
 * `/products/[slug]` turned both into soft 404s and broke §6 SECURITY's "an inactive product
 * is a 404". Both were removed; `lib/navigation.test.ts` now fails if either comes back.
 *
 * `ProductLoading` is kept for the day those pages move their lookup behind a `<Suspense>`
 * boundary INSIDE the page, which streams the grid without touching the status code. That is
 * Stage 4's job.
 *
 * ── Why they are so plain ──
 *
 * Brief §9: skeletons should not be flashy. `Skeleton` already animates with a single
 * opacity pulse that `globals.css` disables under `prefers-reduced-motion`, so nothing here
 * adds motion of its own. Every block below is a real measurement of the component it stands
 * in for — `h-control` for a control, `aspect-square` for a product image — so the swap does
 * not move anything.
 */
import { CONTAINER_GUTTER } from '@/components/shell/container';
import { Card, Skeleton } from '@/components/ui';

/**
 * The page's real title, visually hidden, above every skeleton.
 *
 * A loading state is still a document, and every route that has one of these renders an `h1`
 * once it settles. Without this the page has NO heading at all while it loads, so a screen
 * reader user arriving mid-fetch gets a document with nothing to navigate by — the same
 * defect §9.7 found on the homepage.
 *
 * `screen-reader.spec.ts` caught it as a flake: `/rates` failed its heading-spine assertion
 * once under full-suite load and passed in isolation, because the test had raced the
 * skeleton. A flake that only appears under load is usually a real state nobody had named.
 *
 * The title is the page's own — it is accurate while loading; only the data is pending — so
 * it is replaced, not duplicated, when the content arrives.
 */
function LoadingTitle({ children }: { children: string }) {
  return <h1 className="sr-only">{children}</h1>;
}

/** The heading block `Section` renders when given `eyebrow` + `heading`. */
function SectionHeadingSkeleton() {
  return (
    <div className="mb-6 flex flex-col gap-2">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  );
}

/**
 * A product grid. Matches `ProductGrid`: 2 columns on a phone, 3 from `md`.
 *
 * Six placeholders because that fills the first viewport at every breakpoint the design is
 * checked at without overshooting a short result set enough to be jarring.
 */
export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          {/* The product image is 1:1 — a fixed ratio box, so nothing reflows on swap. */}
          <Skeleton className="aspect-square w-full rounded-card" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      ))}
    </div>
  );
}

export function CollectionLoading() {
  return (
    <div
      className={`mx-auto w-full max-w-[1200px] ${CONTAINER_GUTTER} pt-8 pb-12 md:pt-12`}
    >
      <LoadingTitle>Loading collection</LoadingTitle>
      <SectionHeadingSkeleton />
      <ProductGridSkeleton />
    </div>
  );
}

export function SearchLoading() {
  return (
    <div
      className={`mx-auto w-full max-w-[1200px] ${CONTAINER_GUTTER} pt-8 pb-12 md:pt-12`}
    >
      <LoadingTitle>Search</LoadingTitle>
      <div className="mb-6 flex flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        {/* The search field is a `h-control` input. */}
        <Skeleton className="h-control w-full rounded-field" />
      </div>
      <ProductGridSkeleton count={4} />
    </div>
  );
}

/** `/rates` — the three rate cards, then the history table. */
export function RatesLoading() {
  return (
    <div
      className={`mx-auto w-full max-w-[1200px] ${CONTAINER_GUTTER} pt-8 pb-12 md:pt-12`}
    >
      <LoadingTitle>Today&rsquo;s gold and silver rates</LoadingTitle>
      <SectionHeadingSkeleton />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className="flex flex-col gap-4">
            <Skeleton className="h-4 w-1/3" />
            {/* The rate itself is the largest figure on the card. */}
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-1/4" />
          </Card>
        ))}
      </div>
      <div className="mt-12 flex flex-col gap-2">
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-tap w-full rounded-field" />
        ))}
      </div>
    </div>
  );
}

/** `/account/orders` — a stack of order cards. */
export function OrdersLoading() {
  return (
    <div
      className={`mx-auto w-full max-w-[1200px] ${CONTAINER_GUTTER} pt-8 pb-12 md:pt-12`}
    >
      <LoadingTitle>Your orders</LoadingTitle>
      <SectionHeadingSkeleton />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Card
            key={i}
            className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
          >
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <Skeleton className="h-tap w-1/2 rounded-pill" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/** `/products/[slug]` — gallery above, details beside it from `md`. */
export function ProductLoading() {
  return (
    <div
      className={`mx-auto w-full max-w-[1200px] ${CONTAINER_GUTTER} pt-8 pb-12 md:pt-12`}
    >
      <LoadingTitle>Loading product</LoadingTitle>
      <div className="grid gap-8 md:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-card" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-px w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
