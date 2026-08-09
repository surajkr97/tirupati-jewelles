/**
 * Canonical URLs, shared metadata, and JSON-LD.
 * Created by Phase 9 (§9.6).
 *
 * ── One place, because every one of §9.6's items is the same mistake waiting to happen ──
 * A canonical that points at the wrong origin, a sitemap that lists a route `robots.txt`
 * disallows, and a JSON-LD `offers.price` that disagrees with the price on the page are all
 * failures of AGREEMENT rather than of any single value. They stay in agreement here by
 * being derived from the same two sources: `NEXT_PUBLIC_SITE_URL` (D-018) and the same
 * pricing engine the page renders from.
 *
 * ── The structured data states nothing the page does not ──
 * `Product` carries the price the customer can see, computed by `calculateLine` at request
 * time from the rate in the database — never a stored figure, and never a rounder or nicer
 * one. MASTER-SPEC §8's rule that the shop must not advertise a price it will not transact
 * at applies with more force here, not less: rich results are quoted back to the customer by
 * Google, outside our disclaimer. `priceValidUntil` is therefore set to the end of the ISR
 * window rather than left open, and `availability` says the piece is in store rather than
 * claiming it can be bought online, which it cannot.
 */
import 'server-only';

import { clientEnv } from '@/lib/env';

/** Absolute site origin, without a trailing slash. */
export const SITE_URL = clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');

/**
 * An absolute URL for `path`.
 *
 * Every canonical, every sitemap entry and every JSON-LD `url` goes through this, so a
 * change of origin is one environment variable rather than a search-and-replace that misses
 * the one in the JSON-LD.
 */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * The `alternates.canonical` block for a route.
 *
 * Next resolves a relative canonical against `metadataBase`, which the root layout sets —
 * but a relative value silently becomes the wrong URL if `metadataBase` is ever unset, and
 * the failure is invisible in development where both resolve to localhost. Absolute here.
 */
export function canonical(path: string) {
  return { alternates: { canonical: absoluteUrl(path) } };
}

export interface ShopIdentity {
  shopName: string;
  address: string | null;
  contactPhone: string | null;
}

/**
 * `LocalBusiness` — the shop itself.
 *
 * A jewellery shop is `JewelryStore` in schema.org's vocabulary, which is a `LocalBusiness`;
 * the more specific type is the one Google documents for local results.
 *
 * **Every field is omitted when the owner has not supplied it.** §7.9 makes address and
 * phone optional and they are null on a fresh install. Emitting an empty `address` or a
 * plausible-looking placeholder would be publishing a false business record — the same line
 * DEBT-018 drew for the policy pages, and a worse place to cross it, because structured data
 * is machine-read and ends up in a map listing.
 */
export function localBusinessJsonLd(shop: ShopIdentity) {
  return {
    '@context': 'https://schema.org',
    '@type': 'JewelryStore',
    name: shop.shopName,
    url: SITE_URL,
    ...(shop.address ? { address: shop.address } : {}),
    ...(shop.contactPhone ? { telephone: shop.contactPhone } : {}),
    currenciesAccepted: 'INR',
    // The catalogue prices in rupees and the shop sells over the counter in India.
    areaServed: 'IN',
  };
}

export interface ProductSeo {
  name: string;
  slug: string;
  description: string | null;
  imageUrls: string[];
  /** Integer paise, from `calculateLine` — the figure the page itself renders. */
  pricePaise: bigint;
  purityLabel: string;
  weightGrams: string;
  hallmarkNo: string | null;
}

/**
 * `Product` — one piece.
 *
 * `price` is a decimal string in rupees because schema.org wants a number, and this codebase
 * carries money as integer paise (MASTER-SPEC §4). The conversion happens here, once, and
 * divides rather than rounds: paise are exact and 100 divides them exactly.
 */
export function productJsonLd(product: ProductSeo, priceValidUntil: string) {
  const rupees = `${product.pricePaise / 100n}.${String(product.pricePaise % 100n).padStart(2, '0')}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url: absoluteUrl(`/products/${product.slug}`),
    ...(product.description ? { description: product.description } : {}),
    ...(product.imageUrls.length > 0 ? { image: product.imageUrls } : {}),
    ...(product.hallmarkNo
      ? {
          additionalProperty: [
            { '@type': 'PropertyValue', name: 'HUID', value: product.hallmarkNo },
          ],
        }
      : {}),
    material: product.purityLabel,
    weight: { '@type': 'QuantitativeValue', value: product.weightGrams, unitCode: 'GRM' },
    offers: {
      '@type': 'Offer',
      price: rupees,
      priceCurrency: 'INR',
      /**
       * The rate moves, so the price does. Quoting it without an expiry invites Google to
       * keep showing a figure the shop will not honour — which is MASTER-SPEC §8's exposure
       * with a third party repeating it. The window is the page's own ISR window.
       */
      priceValidUntil,
      /**
       * `InStoreOnly`, not `InStock`. There is no checkout: §6.3's enquiry hands the
       * customer to WhatsApp and the sale happens over the counter. Claiming online
       * availability would be the one structured-data lie a customer could act on.
       */
      availability: 'https://schema.org/InStoreOnly',
      url: absoluteUrl(`/products/${product.slug}`),
    },
  };
}
