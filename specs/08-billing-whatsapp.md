# PHASE 8 — Billing → PDF → WhatsApp → Auto-Order

**Goal:** admin builds a bill, sends a PDF via WhatsApp to a phone number, and the purchase
lands in that customer's order history — even if they have no account yet. **Flagship feature
#3, and the one nobody else has.**

**Agents:** DEV → TEST → SECURITY → DESIGN

---

## The flow

```
Admin opens /admin/bills/new
  → adds items (same engine as the calculator)
  → enters customer phone + name
  → Generate
      • Order created, orderNo assigned
      • Item rates SNAPSHOTTED onto OrderItem
      • PDF rendered, stored at an unguessable key
      • userId set if an account with that verified phone exists,
        otherwise left null
  → Send on WhatsApp
      • opens wa.me with a prefilled message + PDF link
      • admin taps send in WhatsApp
      • returning to the app, admin confirms "Sent"  → sentViaWa = true
  → Customer later verifies that phone (Phase 3)
      → order attaches to their account automatically
```

**Why the deep link, not the Cloud API:** `wa.me` is free, needs no Meta Business
verification, and works today. The one compromise is that the admin taps send manually. The
send layer is behind an interface so the Cloud API can replace it later without touching the
rest.

---

## DEV checklist

### 8.1 Bill builder — `/admin/bills/new`

- [ ] Reuse the Phase 5 calculator components. **Do not fork them.** Extract any shared piece
      into `components/calculator/` and import from both. Two diverging pricing UIs is a
      future defect factory.
- [ ] Additional fields: customer name, customer phone (E.164 normalised, with a `+91` prefix
      affordance), optional note.
- [ ] "Load from product" — pick a catalog product to prefill an item.
- [ ] Live grand total in a sticky bar.
- [ ] Phone validated as a real Indian mobile before `Generate` is enabled.

### 8.2 Order creation — `POST /api/admin/bills`

Wrap the whole thing in a transaction.

- [ ] **Recompute every line server-side.** The client's totals arrive but are discarded. This
      is not optional — it is the difference between a bill and a suggestion.
- [ ] Snapshot `ratePerGram`, `makingPct`, `gstPct` onto each `OrderItem`. A bill reprinted in
      2031 must show 2026's numbers.
- [ ] `orderNo`: `JW-{YYYY}-{seq}`, sequence from a DB counter inside the transaction. **Do
      not derive it from `COUNT(*)`** — concurrent bills will collide.
- [ ] Link to an existing user only if a user has that phone **and** `phoneVerified = true`.
      An unverified matching phone does not link.
- [ ] Write an `AuditLog` entry.
- [ ] Idempotency: accept an `Idempotency-Key` header; a repeated key returns the existing
      order rather than creating a duplicate. Admins on flaky shop wifi will double-tap
      Generate.

### 8.3 PDF generation

`@react-pdf/renderer`, server-side, in the route handler.

**Layout — A4, and it must look like the shop's brand, not a receipt printer:**

- [ ] Header: shop name, address, GSTIN, phone. Logo from a MediaSlot.
- [ ] `TAX INVOICE`, order number, date.
- [ ] Customer name and phone.
- [ ] Rate reference block: _"Rates applied on &lt;date&gt;: Gold 22K ₹X/10g, Gold 18K ₹Y/10g,
      Silver 999 ₹Z/kg"_ — this is what makes the bill defensible months later.
- [ ] Item table: description · purity · weight (g) · rate/g · metal value · making % · making
      amount · stone · taxable value.
- [ ] Totals: taxable value → CGST 1.5% → SGST 1.5% → **grand total in figures and in words**
      (Indian numbering: "Seventy Thousand Nine Hundred and Ninety-Three Rupees Only"). Amount
      in words is expected on Indian invoices.
- [ ] Hallmark / HUID / BIS numbers per item where present.
- [ ] Footer: terms, buyback policy, "computer-generated invoice" note.
- [ ] Typography and colours from the design tokens. Generous margins.

**Storage**

- [ ] Key: `bills/{uuidv4}.pdf` — never sequential, never guessable.
- [ ] Private bucket; served via a signed URL, 7-day expiry, or through an ownership-checked
      route.
- [ ] `X-Robots-Tag: noindex`.
- [ ] Cache the signed URL in Redis at `bill:{key}`, 24h.
- [ ] Generate synchronously for now (it takes ~1s). Phase 9 moves it to Celery if it becomes
      a bottleneck.

### 8.4 WhatsApp send

- [ ] Interface first:

```ts
// lib/whatsapp/index.ts
export interface WhatsAppSender {
  sendBill(o: {
    phone: string;
    orderNo: string;
    total: bigint;
    pdfUrl: string;
  }): Promise<SendResult>;
}
```

Two implementations: `DeepLinkSender` (now) and a stubbed `CloudApiSender` (later). Swap via
config.

- [ ] Deep-link message:

```
Namaste {name},

Thank you for your purchase from {shopName}.

Invoice: {orderNo}
Amount: {formatINR(total)}

Your invoice: {pdfUrl}

View your purchase history: {siteUrl}/account/orders

For any questions, reply to this message.
```

- [ ] `encodeURIComponent` the whole message. SECURITY tests this.
- [ ] After the admin returns from WhatsApp, show a `Mark as sent` confirmation → sets
      `sentViaWa` and `sentAt`. **Do not set it optimistically** — the admin may have
      cancelled, and a false "sent" record is worse than no record.
- [ ] Resend available from the order detail page.

### 8.5 Bills list — `/admin/bills`

- [ ] Search by phone, order number, customer name.
- [ ] Filters: date range, sent/unsent, claimed/unclaimed.
- [ ] Row: order no, customer, total, sent status, claimed status.
- [ ] Detail page: full bill, download PDF, resend, void (soft — never hard delete an invoice;
      note the legal retention requirement in DEBT.md).
- [ ] Export CSV for the accountant.

### 8.6 Customer side

- [ ] `/account/orders` lists claimed orders with a download button.
- [ ] `/account/orders/[id]` — full breakdown, ownership-checked.
- [ ] Prominent prompt for users without a verified phone: _"Bought from us before? Verify your
      phone to see your purchases."_

### 8.7 Dashboard totals

- [ ] Total sold — today / week / month / all time, from `SUM(grandTotal)`.
- [ ] Exclude voided orders.
- [ ] Cache in Redis 60s; invalidate on new bill.

---

## TEST — highest-stakes phase

- [ ] Server recomputation: submit a bill with a **tampered** client total → stored order has
      the correct server-computed total.
- [ ] Rate snapshot: create a bill → change rates → reopen the bill → original figures
      unchanged.
- [ ] Order number: 50 concurrent bill creations → 50 unique sequential numbers, no gaps, no
      duplicates. **Run this with real concurrency, not a loop.**
- [ ] Idempotency key: same key twice → one order.
- [ ] Bill for a phone with **no** account → `userId` null → user signs up and verifies that
      phone → order appears. **The flagship end-to-end test.**
- [ ] Bill for a phone with an **unverified** account → does not auto-link.
- [ ] PDF renders with 1 item and with 20 items without layout breaking.
- [ ] Amount-in-words: ₹1, ₹100, ₹1,00,000, ₹1,00,00,000, and a value with paise.
- [ ] GST split sums exactly to the total GST.
- [ ] WhatsApp URL decodes to the intended message; test a customer name containing `&` and an
      emoji.
- [ ] Dashboard totals match direct SQL.
- [ ] E2E at 375px: admin creates a 3-item bill, generates the PDF, opens the WhatsApp link
      (assert href only), marks sent, and the order appears in the admin list.

---

## SECURITY

- [ ] Bill PDF URL unguessable and unlisted; sequential guessing returns 404.
- [ ] Customer A cannot fetch customer B's bill by ID or by PDF key.
- [ ] Only ADMIN can create bills.
- [ ] Claiming requires **verified** phone ownership — attempt to claim by setting a phone
      field without OTP; must fail.
- [ ] Customer name and note fields escaped in the PDF and in the WhatsApp message.
- [ ] Rate limit bill creation (20/min) to bound abuse of a compromised admin session.
- [ ] Every bill creation and send audited.
- [ ] PDF has no `X-Frame-Options: ALLOWALL` or public-read bucket ACL.

---

## DESIGN

- [ ] The bill builder is usable standing in a shop with one hand.
- [ ] PDF looks like a premium jeweller's invoice, not a system printout.
- [ ] Send flow is unambiguous — the admin always knows what state a bill is in.

---

## Acceptance criteria

1. Multi-item bill, server-computed, rate-snapshotted.
2. Professional PDF with GST split and amount in words.
3. WhatsApp deep link with a correctly encoded message and PDF link.
4. Unclaimed orders attach on verified phone signup.
5. Concurrency-safe order numbering.
6. Dashboard sold totals accurate.
7. Zero CRITICAL/HIGH security findings.
