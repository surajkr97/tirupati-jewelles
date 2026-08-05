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
      className="group flex flex-col gap-3 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      data-testid="product-card"
    >
      <ImageFrame
        src={product.imageUrl}
        alt={product.imageAlt ?? product.name}
        // Fixed ratio => no layout shift as images load (§6.5).
        ratio="1/1"
        // Two-up on mobile, three-up on desktop inside a 1200px container.
        sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 380px"
        priority={priority}
      />

      <div className="flex flex-col gap-1">
        <h3 className="text-body font-medium text-ink group-hover:underline">
          {product.name}
        </h3>
        <p className="text-small text-muted">
          {PURITY_LABEL[product.purity]} · {grams(product.weightMg)} g
        </p>
        <p className="text-body font-semibold text-ink tabular" data-testid="card-price">
          {formatINR(product.price.lineTotal)}
        </p>
      </div>
    </Link>
  );
}

/** §6 DESIGN: 16px gap minimum. `gap-4` is the 16px step on the restricted scale. */
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
