/**
 * Product card.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.1).
 *
 * §6 DESIGN: "Product cards breathe — 16px gap minimum, no dense grid."
 *
 * A server component. The price is computed server-side and belongs in the HTML: it is the
 * number a shopper scans for, and rendering it on the client would flash a blank card and
 * keep it out of search results.
 */
import Link from 'next/link';

import { ImageFrame } from '@/components/ui';
import { formatINR } from '@/lib/money';
import type { PricedProduct } from '@/lib/catalog/products';
import type { PurityKey } from '@/lib/pricing';

const PURITY_LABEL: Record<PurityKey, string> = {
  K22_916: '22K',
  K18_750: '18K',
  SILVER_999: 'Silver',
};

function grams(weightMg: number): string {
  return (weightMg / 1000).toFixed(3).replace(/\.?0+$/, '');
}

export function ProductCard({
  product,
  priority = false,
}: {
  product: PricedProduct;
  /** §6.5: "`priority` only on the first gallery image and the hero." */
  priority?: boolean;
}) {
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col gap-4 rounded-card focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
      data-testid="product-card"
    >
      {/*
        No card chrome — the photograph IS the card.
        
        Brief §11: "do not make every card a floating rounded rectangle; use whitespace and
        image composition instead." A white surface behind a white-background product
        photograph adds a border and takes away contrast; the piece reads better sitting
        directly on the cream page with air around it.

        The hover scale lives on a wrapper rather than on `ImageFrame`, because the frame's
        own `overflow-hidden` is what crops the growth into a slow push-in instead of a
        jump. 250ms and 1.03 — perceptible, not playful (§23).
      */}
      <div className="overflow-hidden rounded-card">
        <ImageFrame
          src={product.imageUrl}
          alt={product.imageAlt ?? product.name}
          // Fixed ratio => no layout shift as images load (§6.5).
          ratio="1/1"
          // Two-up on mobile, three-up on desktop inside a 1200px container.
          sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 380px"
          blurDataURL={product.imageBlur ?? undefined}
          priority={priority}
          className="transition-transform duration-slow ease-standard group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </div>

      <div className="flex flex-col gap-1">
        {/*
          `h2`, not `h3` (§9.7). A product grid sits directly under the page's `h1` — the
          collection name on /collections/[slug], the query on /search — with nothing between,
          so `h3` skipped a level. A screen-reader user navigating by heading hears a gap and
          has to wonder what section they missed.
        */}
        <h2 className="text-body font-medium text-ink group-hover:underline">
          {product.name}
        </h2>

        {/*
          Price above the metadata — brief §11's hierarchy.

          Phase 6 had purity and weight first. The price is what a shopper scans a grid for,
          and burying it under the specification made every card read the same at a glance.
        */}
        <p className="text-body font-semibold text-ink num" data-testid="card-price">
          {formatINR(product.price.lineTotal)}
        </p>
        <p className="text-small text-muted">
          {PURITY_LABEL[product.purity]} · {grams(product.weightMg)} g
        </p>
      </div>
    </Link>
  );
}

/** §6 DESIGN: 16px gap minimum. `gap-4` is the 16px step on the restricted scale. */
/**
 * The catalogue grid.
 *
 * **Children must be `<li>`.** This renders a `<ul>`, and `ProductCard` renders an `<a>` —
 * so a caller that drops cards straight in produces a list whose direct children are
 * anchors, which axe flags as a `list` violation (serious) and which screen readers do not
 * announce as a list at all. Stage 4A did exactly that on the homepage and the axe suite
 * caught it; the collection pages had always wrapped correctly.
 */
export function ProductGrid({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6"
      data-testid="product-grid"
    >
      {children}
    </ul>
  );
}
