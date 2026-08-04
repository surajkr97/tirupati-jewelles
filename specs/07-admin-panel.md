# PHASE 7 — Admin Panel & Media Management

**Goal:** the shop owner runs the entire site from their phone — rates, products, categories,
images, banners. No developer needed for daily operations.

**Agents:** SECURITY (design review) → DEV → TEST → SECURITY (final) → DESIGN

---

## Design intent

The admin is a jeweller, not an operator of a CRUD dashboard. They will use this on a phone,
standing in a shop, between customers. Every screen is mobile-first with the same warmth as
the storefront — no dense enterprise tables.

---

## DEV checklist

### 7.1 Shell

- [ ] `/admin/*` — SSR only, `force-dynamic`, `noindex`.
- [ ] Role checked in proxy **and** re-checked in every handler and page.
- [ ] Bottom nav: Dashboard · Rates · Products · Bills · More.
- [ ] Non-admins get 404, never 403.

### 7.2 Dashboard — `/admin`

Big soft stat cards, not a data grid.

- [ ] Total sold amount — today, this week, this month, all time.
- [ ] Order count and average order value.
- [ ] Bills sent via WhatsApp this month.
- [ ] Enquiries received (from Phase 6 logging).
- [ ] Current rates with an inline "update" shortcut — the most frequent daily action, so it
      belongs on the home screen.
- [ ] Recent orders, last 10.
- [ ] Simple sales bar chart, last 30 days.
- [ ] Low-signal alerts: products with no images, rates not updated in 48h.

### 7.3 Rates — `/admin/rates`

- [ ] Three cards, one per purity, showing the current rate large.
- [ ] Inline edit in the **display unit** (₹/10g, ₹/kg) with a big numeric keypad-friendly
      field.
- [ ] Shows previous value and % change before saving.
- [ ] >20% change requires a confirmation step naming the old and new values. This is the
      single most damaging typo available; make it hard to make.
- [ ] Change history with actor and timestamp.

### 7.4 Products — `/admin/products`

- [ ] List with search, category filter, active toggle.
- [ ] Create/edit form:
  - name (slug auto-generated, editable, uniqueness-checked live)
  - category select
  - description (plain textarea — **not** a rich-text editor; it is an XSS surface for no
    benefit here)
  - metal, purity, weight in grams (stored as mg)
  - making %, stone charge
  - hallmark number, BIS certificate number
  - active / featured toggles
- [ ] Live price preview using `calculateLine` as the admin types.
- [ ] Image management: multiple images, drag to reorder, alt text per image.
- [ ] Bulk actions: activate, deactivate, change category.
- [ ] Delete is a **soft delete** (`isActive = false`). Hard-deleting a product referenced by
      historical orders breaks bills. Note this in the UI.

### 7.5 Categories — `/admin/categories`

- [ ] CRUD, drag-to-reorder, category image, active toggle.
- [ ] Deleting a category with products is blocked with an explanation and a count. Offer to
      reassign instead.

### 7.6 Media — `/admin/media`

This is what the client asked for repeatedly: **every image on the site replaceable from the
dashboard.**

- [ ] Named slots, each a card with preview, dimensions guidance, and both input methods:

| Slot key             | Where         | Recommended |
| :------------------- | :------------ | :---------- |
| `HERO_BANNER`        | homepage hero | 1600×900    |
| `OFFER_STRIP`        | below hero    | 1200×400    |
| `CATEGORY_TILE_1..6` | category grid | 800×800     |
| `FEATURE_BANNER`     | mid homepage  | 1200×600    |
| `ABOUT_IMAGE`        | about page    | 1200×800    |
| `FOOTER_BG`          | footer        | 1600×400    |

- [ ] Each slot accepts **either** a pasted URL **or** a direct upload.
- [ ] Optional headline, subtext, and link URL per slot.
- [ ] Live preview at phone width before saving.
- [ ] Clearing a slot restores the branded empty frame — never a broken image.

### 7.7 URL input — the SSRF surface

**SECURITY: this field is the highest-risk input in the application.** An admin pastes an
arbitrary URL that the server may fetch.

- [ ] Scheme must be `https`. Reject `http`, `file`, `data`, `gopher`, `ftp`.
- [ ] Host must be in `ALLOWED_IMAGE_HOSTS`. Default-deny.
- [ ] Resolve the hostname and reject private, loopback, and link-local ranges: `10.0.0.0/8`,
      `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16` (cloud metadata
      endpoint — the classic target), `::1`, `fc00::/7`.
- [ ] **Re-validate after redirects.** A permitted host can 302 to `169.254.169.254`.
      Validating only the initial URL is the standard mistake.
- [ ] Timeout 5s, max response 10MB.
- [ ] Verify the response is actually an image by **magic bytes**, not by `Content-Type`
      header — headers are attacker-controlled.
- [ ] Do not proxy-fetch at render time. Validate once on save, store the URL, let
      `next/image` handle it thereafter.

### 7.8 Uploads

- [ ] Direct-to-provider signed uploads (UploadThing or Cloudinary). The image bytes never
      pass through the app server.
- [ ] Accept JPEG, PNG, WebP, AVIF only — checked by magic bytes.
- [ ] Max 10MB. Auto-convert to WebP/AVIF, generate 3 sizes and a `blurDataURL`.
- [ ] Filenames replaced with UUIDs. An uploaded filename is never used as a path component.
- [ ] Strip EXIF — jewellery photos taken in-shop carry GPS coordinates of the owner's
      premises.

### 7.9 Settings — `/admin/settings`

- [ ] Shop name, address, GSTIN, contact, owner WhatsApp number.
- [ ] Default GST %, default making %.
- [ ] Bill prefix and next sequence number.
- [ ] Ticker jitter on/off — **surface the env flag in the UI** so the owner can disable it
      without a deploy.
- [ ] Business hours, holiday notice banner.

### 7.10 Audit log — `/admin/audit`

- [ ] Filterable by actor, action, entity, date. Read-only, never editable.

---

## SECURITY — the heaviest review of the build

- [ ] Every `/admin` route and API handler independently re-checks role.
- [ ] Attempt every admin API call with a customer session → all 404.
- [ ] Attempt every admin API call with no session → all 404.
- [ ] **SSRF suite:** try `http://169.254.169.254/latest/meta-data/`, `file:///etc/passwd`,
      `http://localhost:6379`, a permitted host that redirects to a private IP, and a DNS name
      resolving to `127.0.0.1`. All must be rejected.
- [ ] Upload a `.php`/`.html` renamed to `.jpg` → rejected by magic-byte check.
- [ ] Upload a 100MB file → rejected before buffering.
- [ ] XSS: product name `<img src=x onerror=alert(1)>` renders as text everywhere it appears —
      list, detail, bill PDF, WhatsApp message.
- [ ] All admin mutations write an `AuditLog` with actor and IP.
- [ ] Admin session shorter than customer (8h) and re-auth required for settings changes.
- [ ] CSRF: state-changing routes require `SameSite=Lax` plus an origin check.

---

## TEST

- [ ] CRUD for products, categories, media slots.
- [ ] Slug uniqueness enforced.
- [ ] Live price preview matches `calculateLine`.
- [ ] Rate change >20% blocked without confirmation.
- [ ] Category delete with products blocked.
- [ ] Soft-deleted product keeps historical orders intact and renderable.
- [ ] Media slot change → `revalidateTag('media')` → homepage updates.
- [ ] E2E at 375px: log in as admin, update a rate, add a product with an image URL, verify it
      appears on the storefront.
- [ ] Dashboard totals match a direct SQL aggregation.

---

## DESIGN

- [ ] Every admin screen usable one-handed at 375px.
- [ ] Forms use appropriate mobile keyboards throughout.
- [ ] Destructive actions are visually distinct and confirmed.
- [ ] Save state always clear — never ambiguous whether a change persisted.

---

## Acceptance criteria

1. Owner can run the whole site from a phone.
2. All images replaceable by URL or upload, per slot.
3. SSRF suite fully blocked, including the redirect case.
4. Zero admin routes reachable without ADMIN role.
5. Every mutation audited.
