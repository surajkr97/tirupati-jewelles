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
| Lighthouse mobile | ≥ 90 all categories ² |

¹ **Amended from 180KB, with the owner's agreement, against a measurement — see D-035.**
The original figure was not reachable on this stack: `next` (245KB) and `react-dom` (55KB)
alone exceed it before this application contributes a byte, and the measured per-route total
is 278.6KB with no unjustified dependency to remove. Raising a budget to meet an
implementation is normally how budgets stop meaning anything, so the reasoning is recorded
rather than the number quietly edited — and 290KB is set deliberately close to the measured
278.6KB so that a regression still trips it.

² **Measured for the first time in Phase 9 (DEBT-020).** Four of the five key routes pass on
all four categories, including `/products/[slug]` at 91 — the run §6 TEST asked for and could
not have. **`/` scores 79** on performance alone, entirely on LCP, and the applied-throttling
measurement of the same page disagrees with Lighthouse's simulated model by 3.3 seconds. The
criterion is left unmet rather than adjusted; the choice is DEBT-039's. `pnpm lighthouse`.

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
- `lighthouse` + `chrome-launcher` (devDependencies) — §9.2's acceptance criterion 1 and §6
  TEST both ask for Lighthouse **category scores**, which the direct Web Vitals measurement in
  this section cannot produce. `pnpm lighthouse` boots `next start` on its own port, resolves a
  product route that actually has images, and fails if any category is under 90. Added rather
  than run through `dlx` so the number is reproducible and can gate CI. `chrome-launcher` is
  Lighthouse's own launcher and has to be declared explicitly: pnpm's strict `node_modules`
  does not expose a transitive dependency to the importer. Closes DEBT-020; the homepage's
  score is DEBT-039.

---

## 9.3 Activating Celery

The dormant infrastructure from Phase 1 now earns its keep.

> **The jobs run in Node, not Celery — D-042.** Three of the five tasks below render React,
> post to Resend, or drive Cloudinary: TypeScript by nature. Putting `bills.generate_pdf` in
> Python means a **second invoice implementation**, which §8 forbids outright. The queue is
> `lib/queue/` on BullMQ against the same Redis; the worker is `pnpm worker`.
> `backend/celery_app/` is untouched, still in compose, still connected, still undeletable
> (MASTER-SPEC §2, AGENTS.md).

- [~] `bills.generate_pdf` — the handler and the queue exist and the worker serves them.
  **The default path is still synchronous**, because §8.3 gates the move on a condition
  that is not met: _"Generate synchronously for now (it takes ~1s). Phase 9 moves it to
  Celery if it becomes a bottleneck."_ DEBT-029 measured it well under a second and
  nothing has reported it slow. The status-poll UI that the async path needs is not
  built. **DEBT-044.**
- [ ] `rates.rollup_history` — nightly aggregation of rate history into daily candles for the
      sparkline. **Not built:** it needs a table to roll up _into_, which is a new model and a
      migration. DEBT-045.
- [ ] `media.process_image` — resize, convert, generate blur placeholders. **Not built:**
      §9.2 already generates blur placeholders via `scripts/generate-blur.mts`, so this is a
      move rather than a gap. DEBT-045.
- [x] `notify.retry_failed` — retry queue for failed SMS/email. The send IS the job: three
      attempts with exponential backoff, and an exhausted one stays in the failed set.
- [x] `cleanup.expire_shares` — remove expired calculator share links. **Closes DEBT-015**,
      open since Phase 5. Scheduled 03:15 IST.
- [x] Celery Beat schedule for the periodic ones. — `upsertJobScheduler`, keyed so a restart
      updates rather than duplicates. The first attempt used the older `add({ repeat })` form
      and fired immediately on boot; caught in the boot log, not assumed.
- [ ] Flower for monitoring, admin-auth protected. **Not built** — Flower is a Celery tool and
      there is no Celery work to watch. The equivalent for this queue is a Bull Board mounted
      behind `requireAdmin()`. DEBT-045.
- [x] Every task idempotent with bounded retries and a dead-letter queue. — 3 attempts,
      exponential backoff, `removeOnFail: false` so an exhausted job stays inspectable.
      BullMQ's default discards it, and a retry policy whose final state is "gone" is not one.
      Each handler states how it is idempotent rather than claiming it.
- [x] **Each task must degrade gracefully if the worker is down.** PDF generation falls back
      to synchronous rendering. A dead worker must not mean a dead billing feature. —
      structural: `enqueueOrRun`'s fallback is a **required** parameter, so there is no API
      that enqueues without one, and it is the same function the worker calls. **The first
      implementation of this did not work and the test caught it** — see D-042.

## 9.3 — Dependencies added

- `bullmq` — the queue. Against the same Redis the cache uses, so no new backing service.
  Chosen over speaking Celery's wire protocol from Node, which would have made the message
  format an undocumented contract between two languages. See D-042.

---

## 9.4 Monitoring

- [x] Sentry for errors, with PII scrubbing configured **before** launch. — the scrubber is
      set in the same call as the DSN, so there is no window in which one exists without the
      other. It reuses `redact()` from DEBT-036 rather than defining a second rule, which
      that ticket closed by exporting it "for §9.4's Sentry `beforeSend` so the two cannot
      disagree". **7 tests** drive real event shapes — a Prisma unique-constraint error, an
      OTP breadcrumb, a login request body — and assert the phone number, the email and the
      session id are gone, with a negative control so a scrubber that empties every event
      would fail. `SENTRY_DSN` absent is a supported state: no init, no behaviour change.
      **Owner action: create the project and set the DSN.** DEBT-047.
- [~] Uptime checks on `/`, `/api/health`, `/api/rates`. — the application half is done and is
  the harder half: `/api/health` now answers all four alert conditions in one response,
  so an external checker needs one rule rather than four integrations. **Registering the
  checks with a provider is an ops action.** DEBT-047.
- [x] Alerts: error rate spike, DB connection failures, Redis down, Celery queue depth,
      **rates not updated in 24h** (a stale gold rate is a business incident, not a technical
      one). — every condition is exposed at `/api/health` as `checks.<name>.status`. The
      stale-rate one is the reason it lives in the application rather than in a monitoring
      config: no uptime service can see it, because it is a fact about this shop's data.
      Measured working — the development database reports `rates: warn, "last set 76h ago"`.
      Only Postgres returns 503; a stale rate must not take the site out of rotation.
- [ ] Vercel Analytics or Plausible — privacy-friendly, no cookie banner needed. **Not built,
      and it needs an owner decision first.** Vercel Analytics requires Vercel and the deploy
      target is Render (D-011); Plausible requires an account or a self-hosted instance, and
      neither exists. Building against a service that cannot be exercised is what Phase 7
      declined to do for uploads (DEBT-022) — "code that has never run is worse than an
      honest gap". **It also contradicts something already shipped:** §9.6's privacy page
      states there is no analytics service on this site, which is why no cookie banner is
      shown. Adding one means changing that page and the CSP in the same commit. DEBT-046.

## 9.4 — Dependencies added

- `@sentry/nextjs` — §9.4's first item names Sentry. Wired through `instrumentation.ts` so it
  starts once per runtime, before anything serves a request: an error thrown while the server
  boots is exactly the one an init inside a layout would miss. `onRequestError` is exported
  too, because Next otherwise swallows a failed data read inside a Server Component into an
  error boundary and the tracker never sees the most common server error in an App Router
  application.

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

- [x] Metadata per route; OG images for products. — `metadataBase` and a title template on
      the root layout; a product's OG image is the gallery's first photograph, the one the
      page itself gives `priority` to, and is omitted rather than broken when the piece has
      none.
- [x] `Product` and `LocalBusiness` JSON-LD structured data. — `JewelryStore` on the
      storefront layout (never on `/admin` or the auth screens), `Product` on the product
      page. The offer price is `product.price.lineTotal` — **the same value the breakdown
      renders**, asserted against the rendered total in a browser. `InStoreOnly`, because
      there is no checkout.
- [x] `sitemap.xml`, `robots.txt` — `/admin` and `/bills` disallowed. — plus `/account`,
      `/claim` and `/calculator/s`, which §9.6 does not name and which a crawler would
      damage: fetching a claim link **burns a single-use token** (DEBT-011). The sitemap is
      generated from the same queries the pages use, so a deactivated piece leaves it when it
      leaves the catalogue. A test fetches every URL in it.
- [x] Canonical URLs. — absolute, from `lib/seo.ts`. A filtered collection
      (`?purity=…&sort=…&page=2`) canonicalises to the collection itself, which is the
      faceted-navigation duplicate §6.1's URL-state decision was always going to create.
- [x] Legal pages: privacy, terms, refund/exchange, shipping. — written to the stricter rule
      described in the route file: the privacy page **describes what this application
      actually does**, read off the implementation. **The footer had linked to
      `/policies/privacy` and `/policies/terms` since Phase 2 and both were 404s.**
- [x] Rate disclaimer present on the homepage, `/rates`, and every product page. — it was
      **not** on the product page in the form the other two use: a bespoke line there dropped
      "Final price confirmed in store". One `RateDisclaimer`, three surfaces. See D-040.

## 9.6 — Dependencies added

None. `sitemap.ts` and `robots.ts` are Next file conventions, and the JSON-LD is a `<script>`
tag rather than a library — §9.1's CSP carries `unsafe-inline` on `script-src` by an explicit
decision (D-033), so no nonce is needed and none is invented.

---

## 9.7 Accessibility

- [x] `axe` clean on every route. — WCAG 2.1 A/AA over **22 routes × 3 viewports**, including
      the interactive states a page load never reaches (open filter sheet, populated
      calculator, product editor). **99 violation nodes found and fixed**; `e2e/a11y.spec.ts`.
- [x] Full keyboard navigation. — every rendered control reached by Tab, a visible focus
      indicator on each, no trap outside the modal, and the product gallery made operable
      (it was not). `e2e/keyboard.spec.ts`.
- [~] Screen-reader pass on the three flagship flows. — **the structures are asserted, the
  listening is not.** Names, landmarks, the heading spine and the live regions are tested
  in `e2e/screen-reader.spec.ts`; nobody has driven VoiceOver or NVDA over the site.
  DEBT-042.
- [x] Ticker changes announced via `aria-live="polite"` — **polite, not assertive.** A
      per-second assertive region is unusable with a screen reader. — it was already polite
      and was still unusable: at `TICK_INTERVAL_MS` 1000 the queue never drained, and every
      announcement was the **jittered** figure rather than the price. The shimmer is now
      `aria-hidden` and the live region carries the true rate. See D-039.
- [x] Contrast verified on the final palette. — **the palette was fine; the compositions were
      not.** Four tokens moved on measurement (D-038).

## 9.7 — Dependencies added

- `@axe-core/playwright` (devDependency) — §9.7's first checklist item names `axe`. Run
  in-browser against the real rendered page rather than over markup, because the two failures
  it actually found (composited colour, an unreachable scroll region) are both invisible in
  source. WCAG 2.1 A/AA only; axe's `best-practice` tag is excluded and the rules from it
  that matter here — heading order, one `h1` — are asserted explicitly in
  `e2e/screen-reader.spec.ts` instead.

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
- [ ] **`NEXT_PUBLIC_SITE_URL` set to the real origin.** §9.6 made it the source of every
      canonical, every `<loc>` in `sitemap.xml`, the `Sitemap:` line in `robots.txt` and the
      `url` in both JSON-LD blocks. It is `http://localhost:3000` in development and the
      generated artefacts say so — a deploy that forgets it publishes a sitemap of localhost
      URLs and canonicals pointing at a developer's machine, and nothing fails to build.

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
