# PHASE 9 — Hardening, Performance & Launch

**Goal:** production-ready. Full security pass, performance budget met, monitoring live, and
the Celery infrastructure finally put to use.

**Agents:** SECURITY → DEV → TEST → DESIGN

---

## 9.1 Security pass — whole application

- [x] **Headers** in `next.config.ts` (D-002 — spec said `next.config.js`):
  - CSP with no `unsafe-eval`. `unsafe-inline` for styles only if Tailwind forces it, and
    document why.
  - HSTS `max-age=63072000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY`
  - `Permissions-Policy` denying camera, mic, geolocation
- [x] Global rate limiting in proxy, per-IP, Redis-backed. Tighter limits on auth and bill
      routes.
- [x] Every API route confirmed Zod-validated. **Write a test that enumerates route files and
      fails if one lacks a schema import** — a checklist item decays, a test does not.
- [x] `pnpm audit` clean; enable Dependabot.
- [~] Secrets rotated before launch. No secret ever committed. — no secret is committed
  (zero tracked `.env` files, history re-scanned). **`SEED_ADMIN_PASSWORD` is still to be
  rotated**; it was exposed in a working transcript. The stored hash is Argon2id, so the
  database is unaffected — the `.env` value is the exposure. Owner action.
- [x] DB user has least privilege — no DDL rights at runtime.
- [x] Redis password-protected, not publicly bound.
- [x] Error responses leak no stack traces in production.
- [x] Structured logging with phone numbers and emails **redacted**.
- [x] Full OWASP Top 10 review documented in `SECURITY-LOG.md`.

---

## 9.2 Performance

**Budget — mobile, 4G throttled:**

| Metric            | Target                |
| :---------------- | :-------------------- |
| LCP               | < 2.0s                |
| CLS               | < 0.05                |
| INP               | < 200ms               |
| TTFB              | < 400ms               |
| JS bundle (route) | **< 290KB gzipped** ¹ |
| Lighthouse mobile | ≥ 90 all categories   |

¹ **Amended from 180KB, with the owner's agreement, against a measurement — see D-035.**
The original figure was not reachable on this stack: `next` (245KB) and `react-dom` (55KB)
alone exceed it before this application contributes a byte, and the measured per-route total
is 278.6KB with no unjustified dependency to remove. Raising a budget to meet an
implementation is normally how budgets stop meaning anything, so the reasoning is recorded
rather than the number quietly edited — and 290KB is set deliberately close to the measured
278.6KB so that a regression still trips it.

- [x] `@next/bundle-analyzer`; remove anything unjustified. — **nothing unjustified found.**
      Attribution in D-035; the budget is framework, not bloat. Tool needs `--webpack` (D-034).
- [ ] Dynamic-import heavy client components (bill builder, charts, PDF viewer).
      One attempt (`sonner`) measured _worse_ and was reverted — see D-035.
- [x] Verify ISR is actually serving cached HTML — `x-nextjs-cache: HIT` measured on every
      route, under throttling, with the full CSP attached.
- [x] Fonts: `next/font`, subset, `display: swap`, preloaded. — verified in the served HTML:
      one `rel="preload" as="font"` woff2, `latin` subset, `display: swap`.
- [x] Images: AVIF/WebP, correct `sizes`, blur placeholders everywhere. — AVIF confirmed on
      the wire (35.7 kB for the hero at 828w), `sizes`/`imageSizes` present including the LCP
      preload, and **92 blur placeholders generated** (avg 468 bytes) into a nullable column on
      `ProductImage`, `Category` and `MediaSlot`, wired through every `ImageFrame` call site.
      Verified in the served HTML, not only in the database. `scripts/generate-blur.mts`.
- [x] DB: `EXPLAIN ANALYZE` the ten most common queries; add missing indexes. — **two missing
      foreign-key indexes found and added** (`ProductImage.productId`, `OrderItem.orderId`).
      Found by index-coverage audit, not by EXPLAIN: at 25 products a seq scan is the correct
      plan, so EXPLAIN on development data would have shown nothing wrong.
- [ ] Redis hit rate > 80% on rates and products; instrument and confirm.
- [ ] Enable compression and a CDN for static assets.

---

## 9.2 — Dependencies added

- `@next/bundle-analyzer` (devDependency) — §9.2's first checklist item names it. It only
  produces a report on a **webpack** build; Turbopack, the Next 16 default, prints a
  compatibility warning and writes nothing. `pnpm build:analyze` pins `--webpack`. See D-034,
  including the `.next/types` trap that comes with the flag.

---

## 9.3 Activating Celery

The dormant infrastructure from Phase 1 now earns its keep.

- [ ] `bills.generate_pdf` — move PDF rendering off the request path. The admin gets an
      immediate response; the PDF arrives via a status poll.
- [ ] `rates.rollup_history` — nightly aggregation of rate history into daily candles for the
      sparkline.
- [ ] `media.process_image` — resize, convert, generate blur placeholders.
- [ ] `notify.retry_failed` — retry queue for failed SMS/email.
- [ ] `cleanup.expire_shares` — remove expired calculator share links.
- [ ] Celery Beat schedule for the periodic ones.
- [ ] Flower for monitoring, admin-auth protected.
- [ ] Every task idempotent with bounded retries and a dead-letter queue.
- [ ] **Each task must degrade gracefully if the worker is down.** PDF generation falls back
      to synchronous rendering. A dead worker must not mean a dead billing feature.

---

## 9.4 Monitoring

- [ ] Sentry for errors, with PII scrubbing configured **before** launch.
- [ ] Uptime checks on `/`, `/api/health`, `/api/rates`.
- [ ] Alerts: error rate spike, DB connection failures, Redis down, Celery queue depth,
      **rates not updated in 24h** (a stale gold rate is a business incident, not a technical
      one).
- [ ] Vercel Analytics or Plausible — privacy-friendly, no cookie banner needed.

---

## 9.5 Reliability

- [ ] Automated daily Postgres backups, 30-day retention.
- [ ] **Restore tested.** An untested backup is a hope, not a backup.
- [ ] Redis persistence enabled — but the app must survive total Redis loss. Verify by killing
      Redis in staging and browsing the site.
- [ ] Graceful degradation checklist:
  - Redis down → slower, functional
  - Celery down → synchronous fallback
  - SMS provider down → email OTP still works
  - Image CDN down → branded empty frames, no broken layout

---

## 9.6 SEO & content

- [ ] Metadata per route; OG images for products.
- [ ] `Product` and `LocalBusiness` JSON-LD structured data.
- [ ] `sitemap.xml`, `robots.txt` — `/admin` and `/bills` disallowed.
- [ ] Canonical URLs.
- [ ] Legal pages: privacy, terms, refund/exchange, shipping.
- [ ] Rate disclaimer present on the homepage, `/rates`, and every product page.

---

## 9.7 Accessibility

- [ ] `axe` clean on every route.
- [ ] Full keyboard navigation.
- [ ] Screen-reader pass on the three flagship flows.
- [ ] Ticker changes announced via `aria-live="polite"` — **polite, not assertive.** A
      per-second assertive region is unusable with a screen reader.
- [ ] Contrast verified on the final palette.

---

## 9.8 Launch checklist

- [ ] All 9 phases signed off in `SIGNOFF.md`.
- [ ] `DEBT.md` reviewed; nothing CRITICAL outstanding.
- [ ] Staging mirrors production.
- [ ] Real data seeded: actual products, real images, real rates.
- [ ] Admin trained — record a short screen capture of the bill flow.
- [ ] Owner WhatsApp number verified working end to end.
- [ ] Test the full journey on a **real budget Android phone on real 4G.** Not a simulator.
      This is where the 95% of users actually are.
- [ ] Rollback plan documented.

---

## Post-launch backlog

Move to `DEBT.md`, do not build now:

- WhatsApp Cloud API for automatic sending
- Payment gateway, if the business later wants one
- Wishlist, product comparison
- Multi-language (Hindi, Gujarati, Tamil)
- Gold savings scheme tracking
- Customer loyalty programme
- PWA with offline calculator
- Rate alert push notifications

---

## Acceptance criteria

1. Lighthouse mobile ≥ 90 on all key routes.
2. Zero CRITICAL/HIGH security findings.
3. Performance budget met on throttled 4G.
4. Backups tested by actual restore.
5. Monitoring and alerts live.
6. Graceful degradation verified by killing each dependency.
7. Real-device test passed.
