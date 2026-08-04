# 00 — MASTER SPEC

**Read this before any phase file.** Every phase assumes these names, types, and
conventions. If a phase file contradicts this document, this document wins.

> Deviations from this spec that have been consciously accepted are recorded in
> `DECISIONS.md`. The live ones are: Next.js 16 rather than 15 (D-002), and the Next app
> living at the repo root with `frontend/` + `server/` dissolved (D-003).

---

## 1. What we are building

A jewellery retail website for the Indian market. Mobile-first — 95% of traffic is phones.
Three features carry the product:

1. **Live-feel rate ticker** on the homepage — Gold 22K (916), Gold 18K (750) per 10g,
   Silver 999 per 1kg.
2. **Multi-item price calculator** — add several pieces, get one total with making charges
   and GST.
3. **Admin bill → WhatsApp → auto-order** — admin builds a bill, sends a PDF via WhatsApp to
   a phone number, and that purchase automatically lands in that customer's order history
   whether or not they have an account yet.

Everything else (catalog, product pages, cart-like flow) is conventional, with one twist:
**there is no checkout.** The final CTA is _Enquire on WhatsApp_.

**Not in scope:** payment gateway, shipping, live market rate APIs.

---

## 2. Stack

| Layer        | Choice                                     | Note                                           |
| :----------- | :----------------------------------------- | :--------------------------------------------- |
| Frontend     | Next.js 16, App Router, TypeScript strict  | D-002 — spec said 15                           |
| Styling      | Tailwind CSS                               | tokens in §3                                   |
| DB           | PostgreSQL + Prisma                        |                                                |
| Cache        | Redis (ioredis)                            | rates, sessions, rate-limit, OTP               |
| Backend jobs | **Celery — dormant**                       | keep configured, do not delete, do not use yet |
| Auth         | custom (Argon2id + session cookie)         |                                                |
| PDF          | `@react-pdf/renderer`                      | server-side                                    |
| Images       | Next `<Image>` + Cloudinary or UploadThing |                                                |
| Validation   | Zod on every boundary                      |                                                |
| Tests        | Vitest + Playwright                        |                                                |

### On Celery

The repo keeps `backend/celery_app/` with a working Redis broker connection and one no-op
health task. It runs in `docker-compose` but does nothing yet. Phase 9 lists the jobs that
will eventually move there (PDF generation, bulk WhatsApp, rate-history rollups). **Do not
delete it. Do not build features on it yet.**

---

## 3. Design system

The reference is Airbnb / Headout: generous whitespace, soft rounded cards, one warm accent,
near-black text, no heavy borders. Warm taupe accent on cream, pill buttons, rounded photo
cards.

### Tokens — `tailwind.config.ts`

```js
colors: {
  cream:   '#FAF7F4',  // page background
  ink:     '#1A1613',  // primary text, dark buttons
  taupe:   '#B07D62',  // accent — buttons, active pills
  taupeLt: '#E8D5C9',  // accent tint — hover, badges
  line:    '#EFE9E3',  // hairline dividers
  muted:   '#8A817C',  // secondary text  (verify 4.5:1 on cream)
  up:      '#0E9F6E',  // price up
  down:    '#E02D3C',  // price down
}
borderRadius: {
  card: '24px',  pill: '999px',  sheet: '32px',  field: '16px',
}
```

### Rules

- **Spacing scale: 4 / 8 / 16 / 24 / 32 / 48 / 64 only.** Nothing else.
- Section vertical padding: `48px` mobile, `80px` desktop. Minimum.
- Cards: `radius-card`, `bg-white`, `shadow-[0_1px_3px_rgba(26,22,19,0.06)]`. **No borders
  on cards.** Shadow or nothing.
- Buttons: `radius-pill`, height 52px, 16px semibold label. Primary = `bg-ink text-white`.
  Accent = `bg-taupe text-white`.
- Type: Inter or General Sans. H1 32/36 mobile → 48/52 desktop. Body 16/26. Small 14/20.
  **Never below 15px for body copy.**
- Every interactive element ≥ 44×44px.
- Images: always `<Image>`, always `sizes`, `blurDataURL` placeholder, `priority` only on
  the hero.

### Layout

Single column on mobile. Max content width 1200px. Horizontal gutter 20px mobile / 40px
desktop. Bottom nav bar on mobile (Home · Rates · Calculator · Orders · Account) — fixed,
`backdrop-blur`, safe-area inset padding.

---

## 4. Money and units — read carefully

**All money is stored and computed as integer paise (`BigInt` in Prisma, `bigint` in TS).
Never float. Never `number` for currency.**

Format for display only at the last moment, via `formatINR(paise: bigint)`.

### Units

| Metal  | Purity    | Stored as          | Displayed as |
| :----- | :-------- | :----------------- | :----------- |
| Gold   | 916 / 22K | paise **per gram** | ₹ per 10 g   |
| Gold   | 750 / 18K | paise **per gram** | ₹ per 10 g   |
| Silver | 999       | paise **per gram** | ₹ per 1 kg   |

Storing per-gram and multiplying at display time avoids a whole family of unit-conversion
bugs. The admin form accepts the _displayed_ unit (per 10g / per kg) and converts on save —
this is the only place conversion happens.

### The pricing formula — single source of truth

`lib/pricing.ts`. Every surface (calculator, bill, product page) calls this. No one
reimplements it.

```
metalValue   = ratePerGram × weightGrams
makingCharge = metalValue × (makingPct / 100)
subtotal     = metalValue + makingCharge + stoneCharge
gstAmount    = subtotal × (gstPct / 100)        // default 3
lineTotal    = subtotal + gstAmount
```

Round **once**, at `lineTotal`, using banker's rounding to the nearest paise. Do not round
intermediate values — that is where the ₹1 discrepancies come from.

`weightGrams` is a decimal with 3 places, stored as integer milligrams.

---

## 5. Data model (Prisma)

```prisma
model User {
  id            String   @id @default(uuid())
  phone         String?  @unique          // E.164, +91XXXXXXXXXX
  email         String?  @unique
  passwordHash  String?
  name          String?
  phoneVerified Boolean  @default(false)
  emailVerified Boolean  @default(false)
  role          Role     @default(CUSTOMER)
  orders        Order[]
  createdAt     DateTime @default(now())
  @@index([phone])
}
enum Role { CUSTOMER ADMIN }

model OtpCode {
  id         String    @id @default(uuid())
  identifier String                        // phone or email
  channel    Channel
  codeHash   String                        // hashed, never plaintext
  purpose    String                        // SIGNUP | LOGIN | CLAIM_ORDER
  attempts   Int       @default(0)
  consumedAt DateTime?
  expiresAt  DateTime
  createdAt  DateTime  @default(now())
  @@index([identifier, purpose])
}
enum Channel { SMS EMAIL }

model MetalRate {
  id          String   @id @default(uuid())
  metal       Metal
  purity      Purity
  ratePerGram BigInt                       // PAISE per gram
  effectiveAt DateTime @default(now())
  setByUserId String
  @@index([metal, purity, effectiveAt])
}
enum Metal  { GOLD SILVER }
enum Purity { K22_916 K18_750 SILVER_999 }

model Category {
  id        String    @id @default(uuid())
  name      String
  slug      String    @unique
  imageUrl  String?
  sortOrder Int       @default(0)
  isActive  Boolean   @default(true)
  products  Product[]
}

model Product {
  id          String   @id @default(uuid())
  name        String
  slug        String   @unique
  description String?
  categoryId  String
  category    Category @relation(fields: [categoryId], references: [id])
  metal       Metal
  purity      Purity
  weightMg    Int                          // milligrams
  makingPct   Decimal  @db.Decimal(5,2)
  stoneCharge BigInt   @default(0)         // paise
  hasHallmark Boolean  @default(true)
  hallmarkNo  String?
  bisCertNo   String?
  images      ProductImage[]
  isActive    Boolean  @default(true)
  isFeatured  Boolean  @default(false)
  createdAt   DateTime @default(now())
  @@index([categoryId, isActive])
}

model ProductImage {
  id        String  @id @default(uuid())
  productId String
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  url       String
  alt       String?
  sortOrder Int     @default(0)
}

model MediaSlot {
  id        String   @id @default(uuid())
  slotKey   String   @unique               // HERO_BANNER | OFFER_STRIP | CATEGORY_TILE_1 ...
  imageUrl  String?
  linkUrl   String?
  headline  String?
  subtext   String?
  isActive  Boolean  @default(true)
  updatedAt DateTime @updatedAt
}

model Order {
  id              String      @id @default(uuid())
  orderNo         String      @unique      // JW-2026-0001
  userId          String?                  // null until claimed
  user            User?       @relation(fields: [userId], references: [id])
  customerPhone   String                   // E.164 — the claim key
  customerName    String?
  items           OrderItem[]
  subtotal        BigInt
  gstAmount       BigInt
  grandTotal      BigInt
  billPdfKey      String?                  // UUID path segment, unguessable
  sentViaWa       Boolean     @default(false)
  sentAt          DateTime?
  createdByUserId String
  createdAt       DateTime    @default(now())
  @@index([customerPhone])
  @@index([userId])
}

model OrderItem {
  id          String  @id @default(uuid())
  orderId     String
  order       Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  productId   String?
  name        String
  metal       Metal
  purity      Purity
  weightMg    Int
  ratePerGram BigInt                       // SNAPSHOT at bill time
  makingPct   Decimal @db.Decimal(5,2)
  stoneCharge BigInt  @default(0)
  gstPct      Decimal @db.Decimal(5,2)
  lineTotal   BigInt
}

model AuditLog {
  id        String   @id @default(uuid())
  actorId   String
  action    String                         // RATE_SET | ORDER_CREATE | BILL_SEND | PRODUCT_EDIT
  entity    String
  entityId  String
  before    Json?
  after     Json?
  ip        String?
  createdAt DateTime @default(now())
  @@index([entity, entityId])
}
```

**Note the rate snapshot on `OrderItem`.** A bill must render identically in five years
regardless of today's rate. Never recompute a historical bill from the current `MetalRate`.

### The order-claim mechanism

This is the subtle part of the WhatsApp feature. An admin bills a phone number that may not
have an account.

- Order is created with `customerPhone` set and `userId = null`.
- When anyone verifies that phone via OTP — at signup or login — a claim routine runs:
  `UPDATE Order SET userId = ? WHERE customerPhone = ? AND userId IS NULL`.
- The claim runs **only after successful OTP verification of that exact number.** Never on
  an unverified phone field. This is the difference between a feature and an
  account-takeover vector.

---

## 6. Rendering strategy

| Route              | Strategy                                          | Why                                                      |
| :----------------- | :------------------------------------------------ | :------------------------------------------------------- |
| `/`                | **ISR**, `revalidate: 300` + client ticker island | Static shell is instant; only the rate widget is dynamic |
| `/rates`           | ISR 300 + client island                           | same                                                     |
| `/calculator`      | **CSR** in a static shell                         | Pure interaction; rates fetched once on mount            |
| `/products`        | **ISR 600**, `generateStaticParams`               | Catalog changes rarely                                   |
| `/products/[slug]` | **ISR 600**                                       |                                                          |
| `/account/*`       | **SSR**, `dynamic = 'force-dynamic'`              | Per-user, never cached                                   |
| `/admin/*`         | **SSR** + `noindex`                               | Never cached, never static                               |
| `/api/*`           | Route handlers, `no-store`                        |                                                          |

Admin mutations call `revalidateTag()` — so a rate change or new product appears without
waiting for the ISR window. Tags: `rates`, `products`, `categories`, `media`.

---

## 7. Redis

| Key                              | Type        | TTL  | Purpose                             |
| :------------------------------- | :---------- | :--- | :---------------------------------- |
| `rates:current`                  | JSON string | 300s | current rates, read by every render |
| `rates:history:{metal}:{purity}` | sorted set  | 7d   | sparkline data                      |
| `otp:{identifier}:{purpose}`     | string      | 300s | hashed OTP + attempt count          |
| `rl:{ip}:{route}`                | counter     | 60s  | rate limiting                       |
| `session:{sid}`                  | JSON        | 30d  | session store                       |
| `product:{slug}`                 | JSON        | 600s | product detail cache                |
| `bill:{key}`                     | string      | 24h  | signed PDF URL cache                |

**Cache-aside everywhere.** Redis being down must degrade to a slow site, never a broken
one. Wrap every Redis read in a helper that falls through to Postgres on error and logs it.
Never `throw` from a cache miss.

---

## 8. The rate ticker — behaviour and the caveat

Admin sets a base rate. The homepage widget applies a small random fluctuation each second
so the display feels live: green with ▲ when the tick is up, red with ▼ when down.

### Implementation

- Jitter is **presentation only**, in a client component. It never touches the DB, never
  enters a bill, never affects the calculator.
- Magnitude: ±₹101 to ±₹199 on the per-10g display value, as the client specified. Random
  direction each tick.
- Config flag `NEXT_PUBLIC_TICKER_JITTER` — `true | false`. When false, the widget shows the
  flat admin rate and animates only on genuine change. **Ship with a working off-switch.**
- The card always shows: `Indicative rate · Updated <time>` and a line
  `Final price confirmed in store.`
- The **calculator and every bill always use the true admin rate**, never the jittered
  display value. This must be enforced by architecture — the jitter value lives only in
  component state and is never passed anywhere.

**Why the caveat matters:** displaying a price that differs from your transaction price is
exposure under Indian consumer-protection and legal-metrology rules. The disclaimer plus the
calculator using true rates is the mitigation. The off-switch is your insurance. Keep it
working.

---

## 9. Environment

```
DATABASE_URL=
REDIS_URL=
SESSION_SECRET=            # 32+ bytes
OTP_PEPPER=                # 32+ bytes
SMS_PROVIDER_KEY=          # MSG91 / Twilio
SMTP_URL=
NEXT_PUBLIC_OWNER_WA=91XXXXXXXXXX
NEXT_PUBLIC_TICKER_JITTER=true
UPLOAD_PROVIDER_KEY=
ALLOWED_IMAGE_HOSTS=res.cloudinary.com,utfs.io
```

All access through `lib/env.ts`, a Zod-parsed object that throws at boot on a missing var.
No `process.env` anywhere else in the codebase.

---

## 10. Phase order

| #   | Phase                            | File                     |
| :-- | :------------------------------- | :----------------------- |
| 1   | Cleanup & scaffold               | `01-cleanup-scaffold.md` |
| 2   | Design system                    | `02-design-system.md`    |
| 3   | Auth — OTP, phone, email         | `03-auth.md`             |
| 4   | Rates engine + homepage ticker   | `04-rates-ticker.md`     |
| 5   | Multi-item calculator            | `05-calculator.md`       |
| 6   | Catalog + enquiry flow           | `06-catalog-enquiry.md`  |
| 7   | Admin panel + media              | `07-admin-panel.md`      |
| 8   | Billing → PDF → WhatsApp → order | `08-billing-whatsapp.md` |
| 9   | Hardening, perf, launch          | `09-hardening.md`        |

Each phase ends in a running application. No phase leaves the build broken.
