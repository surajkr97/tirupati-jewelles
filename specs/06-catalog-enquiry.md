# PHASE 6 — Catalog & WhatsApp Enquiry

**Goal:** browse categories and products; the final CTA is _Enquire on WhatsApp_, not a
checkout. No payments anywhere in this build.

**Agents:** DEV → DESIGN → TEST → SECURITY

---

## Why there is no checkout

Jewellery of this value is bought in conversation, not in a cart. Every product page ends with
a WhatsApp handoff to the owner. This removes payment-gateway scope, PCI exposure, and refund
logic from the project entirely — a significant simplification, deliberately chosen.

---

## DEV checklist

### 6.1 Category pages

- [ ] `/collections` — grid of categories, ISR 600.
- [ ] `/collections/[slug]` — products in that category, ISR 600, `generateStaticParams` over
      active categories.
- [ ] Filters: purity (22K/18K/Silver), price band, weight band, sort. Filters live in the
      **URL** (`?purity=22k&sort=price_asc`) so a filtered view is shareable and
      back-button-correct.
- [ ] On mobile, filters open in a bottom `Sheet` with an apply button. Never a sidebar
      squeezed onto a phone.
- [ ] Pagination: 24 per page, "Load more" (not infinite scroll — infinite scroll makes the
      footer unreachable and hurts back-navigation).

### 6.2 Product page — `/products/[slug]`

ISR 600, `revalidateTag('products')` on admin edit.

- [ ] Image gallery: swipeable, dot indicators, pinch-zoom. Falls back to the branded
      `ImageFrame` when the admin has supplied no URLs.
- [ ] Name, category, short description.
- [ ] Spec table: metal, purity, gross weight, making %, stone charges if any.
- [ ] **Live price block** — computed server-side from the current true rate, shown as a
      breakdown:

```
Metal value (8.500 g × ₹7,240/g)      ₹ 61,540
Making charges (12%)                  ₹  7,385
Stone / other                         ₹      0
GST (3%)                              ₹  2,068
─────────────────────────────────────────────
Total                                 ₹ 70,993
```

Transparency here is the differentiator. Most jewellery sites show one opaque number; showing
the working builds trust.

- [ ] `Price indicative · based on today's rate` note beneath.
- [ ] **Trust block — required, not optional:**
  - BIS Hallmark mark and hallmark number when present
  - BIS certificate number
  - HUID explanation ("6-digit Hallmark Unique ID, verifiable via the BIS Care app")
  - purity guarantee, buyback and exchange policy links
  - "Certified by" statement

Indian buyers actively check hallmarking. Missing it costs conversions. Render "Hallmark
details available in store" rather than an empty block when the admin has not entered a
number.

- [ ] `Calculate with current rates` → preloads the calculator.
- [ ] Related products from the same category.

### 6.3 The enquiry CTA

- [ ] Sticky bottom bar: price on the left, `Enquire on WhatsApp` on the right, accent taupe,
      52px.
- [ ] Builds a `wa.me` link:

```ts
const msg = `Hi! I'm interested in this piece.

${product.name}
${product.purity} · ${weightGrams}g
Ref: ${product.slug}
Indicative price: ${formatINR(total)}

${siteUrl}/products/${product.slug}

Could you share more details?`;

const href = `https://wa.me/${OWNER_WA}?text=${encodeURIComponent(msg)}`;
```

- [ ] `encodeURIComponent` **is mandatory.** Product names contain `&`, `#`, and quotes;
      unencoded they truncate the message or break the link. SECURITY checks this
      specifically.
- [ ] Log the enquiry (product, timestamp, session) for the admin dashboard **before** opening
      the link — fire-and-forget, must never block or delay the redirect.
- [ ] Floating WhatsApp button site-wide with a generic message.

### 6.4 Search

- [ ] `/search` with Postgres full-text over name, description, category.
- [ ] Debounced 300ms, results cached in Redis 300s.
- [ ] Empty state suggesting popular categories.

### 6.5 Images and performance

- [ ] `next/image` everywhere with correct `sizes`.
- [ ] AVIF then WebP; `remotePatterns` restricted to `ALLOWED_IMAGE_HOSTS`.
- [ ] `blurDataURL` on every image; generate at upload time in Phase 7.
- [ ] `priority` only on the first gallery image and the hero.
- [ ] Lazy-load below-fold images.
- [ ] Fixed aspect ratios on every image container — no CLS.

### 6.6 Account order history

- [ ] `/account/orders` — SSR, `force-dynamic`.
- [ ] Lists orders where `userId` matches the session — **never** filtered by a URL parameter.
- [ ] Each row: order number, date, item count, total, download-bill button.
- [ ] Empty state: _"No purchases yet. If you've bought from us, verify your phone number to
      see your history."_ → links to phone verification. This is the discovery path for the
      Phase 8 claim mechanism.

---

## SECURITY

- [ ] **IDOR:** fetch another user's order by ID → 404. Test it explicitly.
- [ ] Bill download checks session ownership before serving.
- [ ] WhatsApp message text URL-encoded; test with a product named `Ring & "Special" #1 <script>`.
- [ ] Search input parameterised — no SQL injection via the query string.
- [ ] Filter params validated against an allowlist; an unexpected sort value falls back to
      default rather than reaching the query builder.
- [ ] Inactive products return 404 on direct URL access.

---

## TEST

- [ ] Product price matches `calculateLine` output exactly.
- [ ] Price updates after an admin rate change plus revalidation.
- [ ] WhatsApp link decodes back to the intended message.
- [ ] Filters produce correct sets; URL state survives reload.
- [ ] E2E 375px: browse → filter → product → enquire (assert the `wa.me` href, do not actually
      navigate).
- [ ] Order history shows only the session user's orders.
- [ ] Lighthouse mobile on `/products/[slug]`: performance ≥ 90, CLS < 0.1.
- [ ] Product with zero images renders the empty frame without breaking layout.

---

## DESIGN

- [ ] Product cards breathe — 16px gap minimum, no dense grid.
- [ ] Price breakdown is scannable, tabular, aligned on the decimal.
- [ ] Sticky CTA does not obscure content (adequate bottom padding on the page).
- [ ] Trust block reads as reassurance, not legal boilerplate.

---

## Acceptance criteria

1. Catalog browsable and filterable, mobile-first.
2. Product prices computed live from admin rates, shown as a breakdown.
3. Hallmark and BIS information present on every product page.
4. Enquiry opens WhatsApp with a correct, encoded message.
5. No checkout, no payment code anywhere.
6. Lighthouse mobile ≥ 90.
