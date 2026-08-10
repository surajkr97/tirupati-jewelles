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
- [x] Secrets rotated before launch. No secret ever committed. — no secret is committed
      (zero tracked `.env` files, history re-scanned), and **the owner confirms
      `SEED_ADMIN_PASSWORD` has been rotated** (11 Aug). It was exposed in a working
      transcript; the stored hash is Argon2id, so the database was never the exposure — the
      `.env` value was. Recorded on the owner's instruction: a rotation happens in an
      environment this repository cannot read, so nothing here can assert it. What CAN be
      asserted is asserted and still holds — the value is not the `CHANGE_ME` placeholder, and
      `lib/env.ts` refuses to boot in production if it ever is.
- [x] DB user has least privilege — no DDL rights at runtime.
- [x] Redis password-protected, not publicly bound.
- [x] Error responses leak no stack traces in production.
- [x] Structured logging with phone numbers and emails **redacted**. — **§9.4 found this was
      only half true and closed the rest.** DEBT-036 redacted the calls this codebase makes;
      an uncaught route error is printed by **Next**, to stdout, before any of our code sees
      it, so the terminal (and the platform's log viewer in production) carried the email and
      phone in full while the Sentry event for the same error arrived redacted. Measured with
      `pnpm verify:sentry`, not theorised. `installConsoleRedaction()` runs first in
      `instrumentation.ts`. See DEBT-048.
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

² **Amended, with the owner's decision, against a measurement — see D-049.** Lighthouse's
simulated (Lantern) model reports the homepage at 79–86 on performance alone, entirely on LCP.
Under _applied_ 4G throttling — 1.6 Mbps, 150ms RTT, 4× CPU — the same page's LCP is **676ms**,
inside the 2.0s budget above. A model and a measurement of the same load disagree by 3.3
seconds, and **the owner has decided the measurement governs**; the Lighthouse figure is
recorded as a model artefact rather than the contract. `/rates`, `/collections`,
`/products/[slug]` and `/calculator` all pass ≥90 regardless. Amended rather than quietly
edited, the standard D-035 set. Note **DEBT-041 stays open**: every score here comes from a
single run, and `/products/[slug]` straddles 90 across repeats — a methodology defect that
survives this decision. `pnpm lighthouse`.

- [x] `@next/bundle-analyzer`; remove anything unjustified. — **nothing unjustified found.**
      Attribution in D-035; the budget is framework, not bloat. Tool needs `--webpack` (D-034).
- [x] Dynamic-import heavy client components (bill builder, charts, PDF viewer).
      **Not warranted, and the reason is a measurement rather than an opinion — D-053.** All
      three components this line names live on **admin** routes, and those routes are already
      the lightest in the application: the dashboard with its 30-day chart is **196.5 kB**,
      the bill builder **203.9 kB**, against a storefront calculator at **271.4 kB** and a
      290 kB budget. Splitting them would shave bytes off the pages that are furthest under
      the limit, for the one person who ever opens them. There is also no PDF viewer — a bill
      is served as a PDF and the browser opens it. The earlier `sonner` attempt on the
      storefront measured _worse_ (278.6 → 281.0 kB) and was reverted; D-035 already
      attributes the storefront floor to framework code with nothing unjustified to remove.
      Left as `[x]` with the measurement recorded, not as a cosmetic split that would let the
      checklist claim work nobody benefits from.
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
- [x] Redis hit rate > 80% on rates and products; instrument and confirm. — **instrumented
      in `cached()` itself and confirmed at 91.7%.** `pnpm cache:stats --drive` resets the
      counters, **drops `rates:current` so the run starts cold**, drives 60 requests and
      reports: `rates` **11 hits / 1 miss / 0 faults = 91.7%**, the single miss being the cold
      start. An earlier version left the key warm and reported a flattering 100% with zero
      misses — a run that never sees a miss has not exercised the miss counter and cannot
      tell a working instrument from one that only counts hits.
      **Three outcomes, not two:** `hit`, `miss` and `fault`, because a Redis outage is not a
      cache miss and folding them together makes a dead Redis read as 0% — pointing whoever
      sees that number at the cache logic instead of at the box that is down. **14 tests**,
      the discriminating one failing `get` alone so the counter write still lands;
      mutation-checked, and folding `fault` into `miss` fails exactly that one test.
      **"and products" names something that is not in Redis:** a product page is ISR'd HTML
      and a product card is priced from the rate, so the product cache is Next's. Its hit
      rate is `x-nextjs-cache`, measured **100% of 36 cacheable responses** in the same run
      and reported alongside rather than quietly dropped.
- [~] Enable compression and a CDN for static assets. — **compression is on and now
  measured; the CDN is an ops action.** Verified over the wire by `pnpm cache:stats --drive`,
  which checks the edge layer alongside the two cache layers because all three are silent
  when they are wrong: HTML gzipped (74.4 kB → **11.8 kB**), static JS gzipped, static JS
  carrying `public, max-age=31536000, immutable`, and `Vary: Accept-Encoding` so no proxy can
  hand gzip to a client that cannot read it. `/api/rates` is served uncompressed at 406 bytes
  — correct, not a gap: gzip framing costs more than it saves at that size.
  **What is left is genuinely not in this repository.** Next compresses with gzip only;
  Brotli is ~27% smaller again on this HTML (11.8 kB → **8.6 kB**, measured) and comes from
  the edge. And a CDN on Render is a platform setting or a proxy in front, not a config line
  here. What the application can do it does: the assets are _cacheable by_ a CDN, which is
  the precondition — a CDN in front of assets that forbid caching buys nothing. **DEBT-051.**

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
      **Verified against the real transport on 10 Aug** — `pnpm verify:sentry` threw from a
      dev-only route and the event arrived reading `with value v***@example.com for
[phone:…001]`, diagnosis intact, via `auto.function.nextjs.on_request_error`. That
      closed the half unit tests could not reach: `scrubEvent` was known correct, and
      nothing proved `beforeSend` was installed. **Still owner action: the DSN on Render.**
      DEBT-047.
- [x] Uptime checks on `/`, `/api/health`, `/api/rates`. — the application half was the harder
      half and is done: `/api/health` answers all four alert conditions in one response, so an
      external checker needs one rule rather than four integrations. **The owner confirms the
      checks are registered** (11 Aug) — an ops action, recorded on their instruction. DEBT-047
      is closed with one thing to re-check the first time an alert should have fired: the rule
      must assert the response BODY carries `"status":"ok"`, because this endpoint returns 200
      while degraded by design and a status-code-only rule sits green through the stale-rate
      alert §9.4 cares most about.
- [x] Alerts: error rate spike, DB connection failures, Redis down, Celery queue depth,
      **rates not updated in 24h** (a stale gold rate is a business incident, not a technical
      one). — every condition is exposed at `/api/health` as `checks.<name>.status`. The
      stale-rate one is the reason it lives in the application rather than in a monitoring
      config: no uptime service can see it, because it is a fact about this shop's data.
      Measured working — the development database reports `rates: warn, "last set 76h ago"`.
      Only Postgres returns 503; a stale rate must not take the site out of rotation.
- [x] Vercel Analytics or Plausible — privacy-friendly, no cookie banner needed. **Closed on
      the owner's decision: no analytics at all** (DEBT-046). Nothing is added, and three
      things stay true as a result rather than by accident — §9.1's CSP keeps no third-party
      script origin, §9.6's privacy page keeps its "no analytics service, no tracker" sentence,
      and no consent banner is ever required. §6.3's enquiry log already records which product
      each WhatsApp enquiry came from, which is the more actionable signal for this shop.

## 9.4 — Dependencies added

- `@sentry/nextjs` — §9.4's first item names Sentry. Wired through `instrumentation.ts` so it
  starts once per runtime, before anything serves a request: an error thrown while the server
  boots is exactly the one an init inside a layout would miss. `onRequestError` is exported
  too, because Next otherwise swallows a failed data read inside a Server Component into an
  error boundary and the tracker never sees the most common server error in an App Router
  application.

---

## 9.5 Reliability

- [x] Automated daily Postgres backups, 30-day retention. — **the mechanism is built and
      proven here; the owner confirms the schedule and an off-box copy** (11 Aug, recorded on
      their instruction — both live outside this repository). `pnpm backup` takes a `pg_dump --format=custom`, writes it
      0600 into a 0700 `backups/`, records a SHA-256 beside it, prunes by mtime at 30 days and
      **refuses to call an implausibly small file a backup** — a green cron job producing 3 kB of
      header is the failure mode this item exists to prevent. Measured: 465.5 kB from an 11 MB
      database in 0.7s. It dumps as the **owner** role, not the runtime one, because SEC-029's
      least-privilege role would produce a dump that succeeds and silently omits what it cannot
      read. `pnpm backup --help` prints the cron line; on Render the same command is a Cron Job
      service. **One test still owed and not counted as done: the restore has only ever been run
      against a dump on this disk, never against one pulled back FROM the off-box destination —
      which is the version that proves the whole chain rather than the dump format.**
- [x] **Restore tested.** An untested backup is a hope, not a backup. — `pnpm verify:restore`
      restores into a scratch database and compares it to the source on five properties, then
      drops it. **91 invoice PDFs came back byte-identical** (`bytea` digested server-side with
      `md5()`, not counted), 17 tables at 1650 rows exact, money still `bigint` summing to the
      same paise, **all 45 indexes** including the GIN and trigram ones DEBT-023 found had been
      silently dropped once already, and the Prisma migration ledger intact.
      **Mutation-checked twice:** a truncated file fails on `pg_restore`, and a dump taken with
      `--exclude-table-data BillPdf` — which restores with zero errors — fails exactly the two
      checks it should while the other three stay green.
- [x] Redis persistence enabled — but the app must survive total Redis loss. Verify by killing
      Redis in staging and browsing the site. — **it was not enabled, and that was measured
      rather than assumed.** `--requirepass` on the command line means no config file, so Redis
      took the built-in defaults: RDB only, `save 3600 1 / 300 100 / 60 10000`. At this shop's
      write volume only the one-hour rule ever fires, so the real durability window was an
      hour — and this instance holds the **session store** (§3.3), not just cache. Proven by
      `SIGKILL`: a key written and killed away was **gone** on restart, `DBSIZE` back at the
      last snapshot. Now `--appendonly yes --appendfsync everysec`; the same test survives.
      **A `SIGKILL` and not a `docker compose restart`** — a graceful stop writes an RDB on the
      way out, so the polite test passes against the broken configuration. Total-loss browsing
      is the checklist below.
- [x] Graceful degradation checklist: — **all four killed and measured, `pnpm verify:degradation`
      (25 checks) plus `e2e/degradation.spec.ts` (6). Two real defects found and fixed.**
  - Redis down → slower, functional — all four storefront routes 200, `/api/rates` serving the
    true rate from Postgres, `/api/health` 200 and `degraded` rather than 503. **With one
    designed exception now stated out loud: login answers 429, not 500** — `lib/auth/rate-limit.ts`
    fails closed by SEC-005, so browsing stays up and signing in does not. The app reconnects
    without a restart.
  - Celery down → synchronous fallback — **the broker being down and the worker being down are
    different failures and both are checked.** Dead broker: `enqueueOrRun` gives up on its 1s
    deadline and runs the job inline (measured 1037ms). Live broker, no worker: the job is
    accepted and waits, and `/api/health` can see the depth §9.4 alerts on. The run also caught
    D-042's stated cost happening — a push that timed out **landed anyway** when Redis came
    back, so the job ran twice. Harmless exactly because §9.3 required idempotency.
  - SMS provider down → email OTP still works — **it did not. A 500, and an enumeration
    oracle.** `/api/auth/password/forgot` picked `Channel.SMS` for a phone identifier;
    `SmsNotifier` throws (D-011), and the send only runs when the account was FOUND — so a
    registered number returned **500** and an unregistered one **200**, an unauthenticated
    account-existence oracle over the customer list. Now delivered to the account's email
    whatever was typed, with the OTP still keyed on the identifier given, and a delivery
    failure logged rather than allowed to change the response. **5 tests**, 3 of which fail
    against the old route. See D-052.
  - Image CDN down → branded empty frames, no broken layout — **half met, now whole.** With
    every request to `res.cloudinary.com` aborted in a real browser, the layout held perfectly
    — the frame kept its 335×335 box and its tint, no horizontal scroll, price and CTA in place
    — and Chrome painted its torn-page glyph on top, which is the opposite of §2.2's "must look
    intentional while empty, not like a broken page". `ImageWithFallback` swaps to the monogram
    on `onError` **and** on a mount check for an image that already failed before hydration.
    A separate client leaf so `ImageFrame` stays a Server Component: measured **+0.4 kB** on
    `/collections` and 0 elsewhere, against §9.2's 290 kB budget. A negative control asserts the
    photograph still renders when the CDN is up.

**Not on the checklist, measured anyway: where degradation stops.** Postgres has no fallback,
and it is worth knowing how it fails. `/api/health` correctly returns **503** so a load
balancer pulls the instance — and every storefront route kept answering **200 from the ISR
cache** with the database stopped. A customer browsing sees a working shop; nothing dynamic
works. That is the honest boundary.

## 9.5 — Dependencies added

None. `pg_dump`/`pg_restore` come from the `db` container's own image, which is also the only
way to guarantee the client matches the server — `pg_dump` refuses to dump a server newer than
itself, and this machine has no Postgres client installed at all. `scripts/lib/pg.mts` uses a
host binary when there is one, so the same command works against Render's managed database.

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
- [x] Screen-reader pass on the three flagship flows. — **owner-confirmed, 11 Aug: the
      listening has now happened.** Closes DEBT-042, the one §9.7 item automation could not reach —
      axe covers roughly a third to a half of real barriers and none of them can tell you whether
      a heading order is _meaningful_ or whether alt text is _accurate_. What was already asserted,
      and still is: **the structures are asserted, the listening was not.** Names, landmarks, the heading spine and the live regions are tested
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

- [~] All 9 phases signed off in `SIGNOFF.md`. — **Phases 1–8 and §9.1–§9.7 are signed off.**
  Phase 9's block records what is deliberately unbuilt (DEBT-044, 045, 051) and the two
  acceptance criteria that cannot be met from inside the repository — the screen-reader pass
  and the real-device run.
- [x] `DEBT.md` reviewed; nothing CRITICAL outstanding. — **19 open: zero CRITICAL, zero
      HIGH, 5 MEDIUM, 13 LOW, 1 INFO, against 31 closed.** The MEDIUMs are DEBT-009 (the ops
      half of the proxy-hop confirmation), 026 (a stated invoice-retention period), 027 (Indic
      script on invoices), 031 (reconciling 30-day dump retention with six-year invoice
      retention) and 034 (IGST the first time the shop ships out of state). None blocks a
      launch, and each names the condition that would make it urgent.
- [ ] Staging mirrors production. — **the only §9.8 item left, and it is a Render setup
      task.** "Mirrors" means, concretely: Node 24 LTS (`.nvmrc`), **Postgres 16** and **Redis 7**
      to match `docker-compose.yml`, the same build and start commands, and the same env var
      _names_ from `lib/env.ts` — which throws at boot on a missing one, so a short staging
      environment fails loudly rather than serving broken pages. `SENTRY_ENVIRONMENT=staging`, so
      its errors are distinguishable from production's.

  **Trap one — its own Postgres AND its own Redis.** Not a second database on the same Redis
  instance; a separate instance. DEBT-030 recorded this exact class of bug at the test level:
  `DATABASE_URL` was pointed at the test database and `REDIS_URL` was not, so integration
  tests wrote `rates:current` and the running dev app served it — `/api/rates` reporting gold
  18K at ₹0 on a machine whose Postgres was fine. Staging sharing production's Redis is that
  same bug with **sessions** in it.

  **Trap two — do not restore a production dump into staging.** DEBT-031: a dump holds every
  customer invoice — 91 of them, 521 kB, names, phone numbers and purchase histories in a
  directly readable format. Staging is by definition less guarded and more widely accessible.
  Copying real customer data into a lower environment is the commonest way a small shop has a
  breach without ever being attacked.

  **`pnpm db:anonymise` exists so this is not a choice between safe and useful.** Seeding
  staging with invented data is safe and loses the point — you cannot find a defect that only
  appears at 46 products and 91 orders against a database holding three of each. The script
  keeps the shape and destroys the people: restore the dump into staging, run it, and every
  name, number and email is a reserved-range stand-in. Replacements are **deterministic**, so
  the same number maps identically in `User.phone`, `Order.customerPhone` and
  `ClaimToken.phone` — proven on a real restored dump, **44 of 44 claimed orders still match
  their owning user**, so §8's flagship claim flow still works in staging. Invoice PDFs, OTPs,
  the audit log and calculator shares are **deleted** rather than rewritten, because a
  half-scrubbed PDF is worse than none. It refuses to run without an explicit
  `ANONYMISE_DATABASE_URL`, and refuses again if that URL is this project's own database.

- [x] Admin trained — record a short screen capture of the bill flow. — **owner-confirmed,
      11 Aug.** Recorded on their instruction; a screen capture is not an artefact this repository
      can see.
- [x] Owner WhatsApp number verified working end to end. — **owner-confirmed 11 Aug: a test
      message was sent and arrived.** The number is set, it lives
      where the owner can change it, and every link on the site uses it; the "a message actually
      arrives" half is yours.** Supplied 11 Aug. It is in the **`Settings` row** — the field
      §7.9 gave the owner — with `.env` as the fallback for a shop that has never opened that
      screen. Neither value is in the repository; `.env.example` keeps its placeholder.

  Verified in the SERVED HTML rather than in the config, and with the fallback made a
  **decoy** so the result discriminates: `Settings` holding the real number, `.env` holding
  `910000000000`, and `/`, `/policies/buyback`, `/products/classic-solitaire-ring` and
  `/collections` carrying **13 links on the Settings value and zero on the decoy**. One live
  client chunk contains a placeholder-looking number and it is benign — chased rather than
  assumed: it is the example inside `lib/env.ts`'s Zod error message, which reaches the
  browser because client components import `clientEnv`.

  **This item found and closed DEBT-050 on the way.** The `ownerWhatsApp` field had been
  write-only since §7.9 — stored, displayed back, and read by nothing — so the owner could
  have changed their number, watched it save, and had every customer keep messaging the old
  one. That is now the mechanism, not a decoration.

  **The thumb has now been applied** — the owner confirms a message sent from the site
  reached the shop, which is the half no assertion in this repository could ever make.
  Setting `NEXT_PUBLIC_OWNER_WA` in Render remains worth doing so the _fallback_ is also
  right, noting it is inlined at BUILD time and so needs a redeploy rather than a restart.

- [x] Test the full journey on a **real budget Android phone on real 4G.** Not a simulator.
      This is where the 95% of users actually are. — **owner-confirmed, 11 Aug.** The criterion
      §9.2 could never satisfy from a laptop: every performance figure in this phase comes from
      either Lighthouse's simulated model or applied CPU/network throttling on desktop hardware,
      and D-049 turned on the 3.3-second gap between those two. A real phone on a real network is
      the only measurement that settles it. Note **DEBT-006 stays open** — the bottom nav clearing
      the iOS home indicator is an iPhone question, and an Android run does not answer it.
- [x] Rollback plan documented. — **`specs/ROLLBACK.md`**, written against this system rather
      than as a generic runbook. Its load-bearing point: a deploy is **three** things that roll
      back at different speeds — code (a Render button, ~2 min), schema (**forward-only**,
      Prisma has no down migrations) and data (never). Rolling back code does not undo a
      migration, so the plan is mostly a decision taken **before** shipping: classify the
      migration, and use expand/contract for anything that is not additive. All 10 migrations
      to date are additive. It also records the traps peculiar to this shop — `BillSequence`
      cannot give an invoice number back and SEC-029 makes the runtime role unable to delete
      one (void and reissue instead, §8.5); `NEXT_PUBLIC_*` is baked in at build time so a
      rollback reverts those values and a dashboard change needs a rebuild; Redis down is not
      an outage but signing in stops; Postgres down IS one and the ISR cache will disguise it.
- [x] **`NEXT_PUBLIC_SITE_URL` set to the real origin** — owner-confirmed (11 Aug) in the
      Render environment. Note the local `.env` correctly still reads `http://localhost:3000`;
      that is the development value and must stay. Original: §9.6 made it the source of every
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

1. ~~Lighthouse mobile ≥ 90 on all key routes.~~ **Amended (D-049, owner's decision):** the
   applied-throttling measurement governs, and the homepage's LCP of 676ms meets the budget in
   §9.2. Four of five key routes pass ≥90 on all categories anyway; the homepage's simulated
   score is recorded as a model artefact. See footnote ² above.
2. Zero CRITICAL/HIGH security findings.
3. Performance budget met on throttled 4G.
4. Backups tested by actual restore.
5. Monitoring and alerts live.
6. Graceful degradation verified by killing each dependency.
7. Real-device test passed.
