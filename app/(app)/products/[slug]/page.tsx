/**
 * /products/[slug] — the product page.
 * Created by Phase 6 (specs/06-catalog-enquiry.md §6.2, §6.3).
 *
 * ISR 600 with `generateStaticParams` (MASTER-SPEC §6). The price block is rendered from
 * the rate at generation time, and `RATE_SURFACES` in `lib/rates.ts` now includes this
 * route so a rate change invalidates it immediately rather than after the window — the
 * obligation Phase 4 left as DEBT-014.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EnquiryBar } from '@/components/product/enquiry-bar';
import { Gallery } from '@/components/product/gallery';
import { PriceBreakdown } from '@/components/product/price-breakdown';
import { ProductCard, ProductGrid } from '@/components/product/product-card';
import { TrustBlock } from '@/components/product/trust-block';
import { Section } from '@/components/shell';
import { Card } from '@/components/ui';
import {
  activeProductSlugs,
  getProductBySlug,
  getRelatedProducts,
} from '@/lib/catalog/products';
import { formatINR } from '@/lib/money';
import type { PurityKey } from '@/lib/pricing';

export const revalidate = 600;

type Params = Promise<{ slug: string }>;

const PURITY_LABEL: Record<PurityKey, string> = {
  K22_916: '22K (916 gold)',
  K18_750: '18K (750 gold)',
  SILVER_999: '999 silver',
};

export async function generateStaticParams() {
  const slugs = await activeProductSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) return { title: 'Piece not found' };

  return {
    title: product.name,
    description:
      product.description ??
      `${product.name} — ${PURITY_LABEL[product.purity]}, hallmarked, priced from today's rate.`,
  };
}

function grams(weightMg: number): string {
  return (weightMg / 1000).toFixed(3);
}

export default async function ProductPage({ params }: { params: Params }) {
  const { slug } = await params;

  const product = await getProductBySlug(slug);
  // `getProductBySlug` filters on `isActive` in the WHERE clause, so an inactive product is
  // indistinguishable from a missing one here — §6 SECURITY: "Inactive products return 404
  // on direct URL access."
  if (!product) notFound();

  const related = await getRelatedProducts(product.categorySlug, product.slug);

  return (
    <>
      <Section className="pt-6 md:pt-12">
        <div className="flex flex-col gap-8 md:flex-row md:gap-12">
          <div className="md:w-1/2">
            <Gallery images={product.images} name={product.name} />
          </div>

          <div className="flex flex-col gap-6 md:w-1/2">
            <div className="flex flex-col gap-2">
              <Link
                href={`/collections/${product.categorySlug}`}
                className="text-small font-medium text-taupe-deep hover:underline"
              >
                {product.categoryName}
              </Link>
              <h1 className="text-h1 font-semibold tracking-tight text-ink">
                {product.name}
              </h1>
              {product.description && (
                <p className="text-body text-muted">{product.description}</p>
              )}
            </div>

            {/* §6.2's live price block — the working, not just the answer. */}
            <Card>
              <PriceBreakdown
                price={product.price}
                weightMg={product.weightMg}
                ratePerGram={product.ratePerGram}
                makingPct={product.makingPct}
                gstPct={product.gstPct}
              />
            </Card>

            <Card className="flex flex-col gap-4">
              <h2 className="text-h3 font-semibold text-ink">Specifications</h2>
              <dl className="flex flex-col gap-4 text-body">
                <Spec label="Metal & purity" value={PURITY_LABEL[product.purity]} />
                <Spec label="Gross weight" value={`${grams(product.weightMg)} g`} />
                <Spec label="Making charge" value={`${product.makingPct}%`} />
                {product.stoneCharge > 0n && (
                  <Spec
                    label="Stone / other charges"
                    value={formatINR(product.stoneCharge)}
                  />
                )}
              </dl>
            </Card>

            {/* Required on every product page, never optional (§6.2). */}
            <TrustBlock
              hasHallmark={product.hasHallmark}
              hallmarkNo={product.hallmarkNo}
              bisCertNo={product.bisCertNo}
            />

            {/*
              §6.2: "Calculate with current rates → preloads the calculator."
              A plain link into the Phase 5 query-string contract — no new endpoint and no
              shared state, which is exactly why that contract was built that way.
            */}
            <Link
              href={`/calculator?purity=${product.purity}&weight=${grams(product.weightMg)}&making=${product.makingPct}&stone=${(Number(product.stoneCharge) / 100).toFixed(2)}&label=${encodeURIComponent(product.name)}`}
              className="inline-flex h-control items-center justify-center self-start rounded-pill bg-ink px-6 text-body font-semibold text-white transition-transform duration-fast ease-standard active:scale-[0.98]"
              data-testid="calculate-link"
            >
              Calculate with current rates
            </Link>
          </div>
        </div>
      </Section>

      {related.length > 0 && (
        <Section eyebrow="More from" heading={product.categoryName}>
          <ProductGrid>
            {related.map((item) => (
              <li key={item.id}>
                <ProductCard product={item} />
              </li>
            ))}
          </ProductGrid>
        </Section>
      )}

      <EnquiryBar
        productId={product.id}
        product={{
          name: product.name,
          slug: product.slug,
          purity: product.purity,
          weightMg: product.weightMg,
          lineTotal: product.price.lineTotal,
        }}
      />
    </>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink tabular">{value}</dd>
    </div>
  );
}
