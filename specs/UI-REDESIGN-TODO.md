# UI REDESIGN — TODO

Companion to `UI-REDESIGN-AUDIT.md`. Ordered so each stage compiles, ships and is verifiable
on its own — the same rule `AGENTS.md` applies to phases.

**Working rule (brief §32):** inspect → smallest safe change → verify at 390px → verify
desktop → run the relevant tests → tick the box. Never batch unrelated changes.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Stage 0 — Audit

- [x] **01 Repository + route audit** — `UI-REDESIGN-AUDIT.md` §A
- [x] **02 Existing UX problems documented** — §C, 11 confirmed findings + 7 non-findings
- [x] **Palette measured against the contrast gate** — §E, 10 of 26 pairs fail, corrections derived

### Blockers

- [x] **B-1 MASTER-SPEC §3 superseded** — recorded as **D-056**, palette only; every
      non-visual rule explicitly left standing.
- [x] **B-2 Reference image** — received. Confirms the audit's reading: rose deltas on a rose
      tint, gold confined to wine surfaces, white cards on cream, minimal shadow.
- [x] **B-3 `/about` + `/contact`** — **D-060**: not created, not linked. No fake hrefs.
      Owner may supply copy; the `/policies/[slug]` pattern would hold both without a new route.
- [x] **B-4 Admin desktop sidebar** — **D-059**: sidebar at `md:`, bottom nav below it.
      Implemented in Stage 5.

---

## Stage 1 — Foundations ✅ COMPLETE

Nothing visual ships here. This is the layer everything else consumes.

- [x] **03 Design tokens** — `globals.css` `@theme` swapped to wine/rose using the
      **measured** values, `lib/design/tokens.ts` mirrored, `contrast.test.ts` rewritten.
      One change, not incremental. (D-056, D-057)
      - [x] `muted` → **`#6E6B72`** — note this is *below* the audit's `#706D74`. Adding
            `line` to the constraint set moved it: the hairline surface measured 4.41, not
            cream. Both are recorded.
      - [x] `rose` `#D9486B` — non-text only, fenced by a failing-direction assertion
      - [x] `roseDeep` `#B3324F` — the interactive token
      - [x] `gold` `#C9A227` — wine surfaces only; asserted to fail on cream *and* white
      - [x] `wine` / `wine-deep` / `wine-soft` added with their on-surface pairs
      - [x] Shadows re-tinted from ink-brown to wine; alphas unchanged
      - [x] `themeColor` in `app/layout.tsx` re-synced to `--color-cream`
      - [x] **57 contrast assertions pass** (was 30)
- [x] **04 Typography** — Playfair Display added beside Inter as `--font-display`, weights
      400/500 only, `preload: false` until the Stage 4 hero paints serif above the fold.
      `.num` aliased to `.tabular` — one rule, two selectors, ~40 call sites untouched.
- [x] **05 Primitives**
      - [x] `Button` — repalletted; **`onWine` / `onWineOutline`** variants added for wine
            surfaces (`accent` on wine is a 1.6:1 fill and dissolves)
      - [x] **`buttonClasses` extracted to `button-classes.ts`** — no client boundary, so a
            *server*-rendered anchor gets byte-identical styling. Closes
            UI_REDESIGN_DEBT-003; **all four** hand-copied clones retired (audit said three)
      - [x] `Card` — `tone="wine"`, which carries `.surface-wine` and drops the shadow
      - [x] **`Chip`** — new primitive; `<button>`, `aria-pressed`, 44px, selection signalled
            by luminance not hue
      - [x] `Input` / `Badge` / `Sheet` / `Skeleton` / `EmptyState` — token-driven already;
            inherited the palette with no change needed
      - [x] Three tint surfaces flattened from alpha to solid (D-058) — a 50% `rose-tint`
            track measures **1.02:1** against cream and is invisible
      - [x] Every variant proved in `/__design`, with per-swatch contrast on **both** grounds
- [x] **Focus states** — `.surface-wine` inverts the ring to cream. The default ink ring is
      **1.05:1 on wine**; a keyboard user would have seen nothing. Tied to `Card tone="wine"`
      so a wine surface cannot be built without it.
- [x] **`taupe` → `rose` rename** — 137 occurrences, 46 files, mechanical (D-058). Comments
      carrying the *old* palette's measured ratios were corrected by hand, not renamed —
      renaming alone would have left false numbers in the tree.
- [x] **All 15 `rose-tint/NN` alphas flattened** (D-061). The lighter tint disappears when
      composited — `bg-rose-tint/50` is **1.02:1** against cream. This included the admin
      dashboard's "More" card, the only route to Settings and Audit.

### Stage 1 verification

| Gate | Result |
| :--- | :--- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm build` | pass — 70 routes prerendered |
| `pnpm test` (unit) | **1221 passed**, 7 skipped, 57 files |
| Contrast gate | **57 assertions pass** (was 30) |
| Spacing lint (`no-off-scale-spacing`) | pass — no new off-scale values |
| `e2e/a11y.spec.ts` (axe, 3 viewports) | pass — the new palette clears axe **as rendered** |
| `e2e/design-system.spec.ts` | pass — incl. 44px tap targets and the 15px prose floor |
| `e2e/keyboard.spec.ts`, `screen-reader.spec.ts` | pass |
| Full Playwright suite | **517 passed**, 2 not run, exit 0 — re-run after the tint flattening, so this reflects the final tree |
| Business logic / API contracts / auth | **untouched** — no file under `lib/pricing`, `lib/bills`, `lib/auth`, `app/api`, or `prisma/` was modified |
| New arbitrary colours | none — one hex outside `globals.css`, the PWA `themeColor`, re-synced to the token |
| Focus states | visible on both grounds; ink 16.32:1 on cream, cream 15.51:1 on wine |

> **Note on the working tree.** While Stage 1 was in progress the tree also held the tail of
> an unrelated change — the dormant Celery worker's removal, touching `backend/`,
> `scripts/worker.mts`, `AGENTS.md`, `README.md` and `.github/*`. That work landed
> separately as `ff16ce1` and is **not** part of this branch. Stages 1 and 2 commit as one
> unit containing only redesign changes.

**Typography at 320 / 390 / desktop:** the type scale is unchanged — Stage 1 added a serif
*family* and changed no size, so the existing 375/768/1280 gates still bind. `320px` is not
yet a Playwright project; added as an explicit Stage 6 task rather than claimed here.

### Carried out of Stage 1

- **Adopt `Chip`** in the search suggestions, the filter sheet and the calculator's metal
  switch. Left as hand-rolled copies deliberately — adopting the primitive edits page
  components, which is Stage 4's scope. (D-061)
- **The bill PDF now renders `roseDeep`/`roseTint` accents** via the rename. It still reads
  quiet, but brief §19 wants the invoice deliberately quieter than the site — review it as
  part of Stage 5 item 27 rather than assuming the inherited palette is right.
- **`preload: false` on the display serif** — flip to the default when the Stage 4 hero
  paints serif above the fold.

---

## Stage 2 — Shell, wayfinding and route states ✅ COMPLETE

The audit's highest-value fixes. Each is small and independently shippable.

- [x] **06 Header** — desktop nav (Rates · Calculator · Collections) at `md:`, mobile menu
      sheet, WhatsApp CTA, search + account. **Fixes C-1, the largest nav defect.**
      The `overlay` hero mode is built but **not enabled** — see D-062 and Stage 4.
      About/Contact omitted per D-060: no fake hrefs.
- [x] **07 Mobile bottom nav** — now renders from `lib/navigation.ts`. Structure, safe-area
      handling and `BottomNavSpacer` untouched, as planned; only the source of the list moved.
- [x] **08 Footer** — deferred from Stage 2 on purpose, **restyled in Stage 4E**: a wine
      footer belongs with the wine hero and trust band, not on its own.
- [x] **09 Route states** — `not-found.tsx`, `error.tsx`, `global-error.tsx` at the root;
      `loading.tsx` for `/search`, `/account/orders`, `/rates`. **Fixes C-2.**
      - [x] **`/collections/[slug]` and `/products/[slug]` deliberately have NO
            `loading.tsx`** — streaming commits a 200 before `notFound()` runs, which turned
            both into soft 404s. Reverted; guarded by a unit test. D-065.
      - [x] The branded 404 also serves `proxy.ts`'s `/__not-found` rewrite — verified by E2E
      - [x] **No `app/admin/not-found.tsx`, deliberately.** §3.6 requires a 404 that does not
            confirm the route exists; an admin-branded one with "Back to dashboard" would
            confirm it as loudly as a 403. Asserted by test.
- [x] **10 Admin shell** (pulled forward from Stage 5) — desktop rail at `md:` with all eight
      destinations plus "← Back to site"; phone keeps its bottom bar and gains a real "More"
      sheet. **Fixes C-5 and C-6.** D-059, D-063.
- [x] **11 Sign-in destination** (pulled forward from Stage 3) — `lib/auth/safe-next.ts`;
      `ADMIN → /admin`, `CUSTOMER → /account`, valid `?next=` wins. **Fixes C-3**, closes
      UI_REDESIGN_DEBT-002. Applied to login, signup and forgot-password.
- [x] **12 Admin shortcut on `/account`** — C-3's other half, for admins arriving by bottom
      nav or password reset.
- [x] **13 Navigation registry + dead-link gate** — `lib/navigation.ts` and its test resolve
      every destination against the real `app/` tree, both directions. D-064.

### Four real bugs found or introduced, all caught by the gates

Two were pre-existing and surfaced only because 320px had never been measured. Two were
introduced by Stage 2 and were caught by tests that already existed.

Neither was introduced by Stage 2; both were found because 320px had never been measured.

- **`/rates` scrolled sideways 21px at 320px.** The history table's `overflow-x-auto`
  container was `position: static`, so its thirteen absolutely-positioned `.sr-only`
  descendants (the caption and one per row) escaped the clip and landed in the document's
  scroll region. Fixed with `relative`. The container itself measured perfectly the whole
  time — 280px wide, 321px of content, `overflow: auto` — which is why width comparisons
  looked fine.
- **The header overflowed 50px at 320px and 360px.** `cn('hidden md:inline-flex',
  buttonClasses(...))` put the base's `inline-flex` last, so tailwind-merge resolved the
  `display` conflict against `hidden` and the Enquire button rendered at every width. It fits
  at 375px with 5px to spare, which is why nine phases never saw it.
- **INTRODUCED — skeletons turned two routes into soft 404s.** `loading.tsx` forces streaming,
  which commits `HTTP 200` before `notFound()` can run. Caught by `catalog.spec.ts`, which has
  asserted the status code since Phase 6. Reverted on those two routes; a new structural test
  fails if a `loading.tsx` is ever added beside a page that calls `notFound()`. D-065.
- **INTRODUCED — the admin rail put the sticky bar out of AA.** `StickyBar` is
  `fixed inset-x-0` at `z-40`, so it painted `cream/90` over the new `z-30` wine rail;
  `muted` on that composite (`#e7e0e0`) measures 4.02:1. Caught by `a11y.spec.ts` on
  `/admin/bills/new`. The bar's left edge is now a variable the admin shell sets. D-066.
- **INTRODUCED — loading states had no heading.** The skeletons rendered no `h1`, so a screen
  reader arriving mid-fetch got a document with nothing to navigate by. It surfaced as a
  `screen-reader.spec.ts` **flake** — `/rates` failed once under full-suite load and passed in
  isolation, because the test had raced the skeleton. Every skeleton now carries the page's
  real title as an `sr-only` `h1`. A flake that only appears under load is usually a real
  state nobody had named.

### Two suite-health fixes, so the above is a real green rather than a lucky one

Three long tests (`seo`, `admin`, `bills`) timed out under four-worker load while passing in
isolation. Stage 2 added 66 tests to a suite that shares one dev server, and that was the
cause — so the fix was to give the capacity back, not to raise the timeouts:

- `e2e/responsive.spec.ts` loaded six routes at all eight widths (48 navigations in one
  describe). Overflow is a narrow-viewport failure — both bugs it found were gone by 375px —
  so the full route list now runs at 320/360/390/414 and only `/` and `/rates` above that.
- `e2e/seo.spec.ts` fetched ~55 sitemap URLs strictly sequentially. Now a pool of six. Every
  URL is still fetched and any non-200 still fails; only the scheduling changed.

### Stage 2 verification

| Gate | Result |
| :--- | :--- |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm build` | pass — 71 static pages |
| `pnpm test` (unit) | **1303 passed**, 7 skipped, 59 files (+82 from Stage 1) |
| `lib/navigation.test.ts` | 56 assertions — every nav href resolves; every admin route is in a menu; no `loading.tsx` beside a `notFound()` |
| `lib/auth/safe-next.test.ts` | 26 assertions — 13 hostile `next` values rejected |
| `e2e/navigation.spec.ts` | 33 passed — one test per audit finding |
| `e2e/responsive.spec.ts` | 33 passed |
| Full Playwright suite | **631 passed, 0 failed**, 165 skipped |

### Responsive — actually measured, not asserted

Driven with `setViewportSize` in an **un-emulated** context. The `mobile-375` project sets
`isMobile: true`, which pins a device layout viewport and made `setViewportSize(320)` report
geometry against 375 — the first run's "failures" were that artefact, not the page.

| Width | Storefront | Header controls | Bottom nav | `/admin` |
| ---: | :--- | :--- | :--- | :--- |
| 320 | pass | pass | pass | pass |
| 360 | pass | pass | pass | pass |
| 390 | pass | pass | pass | pass |
| 414 | pass | pass | pass | pass |
| 768 | pass | pass | n/a | pass |
| 1024 | pass | pass | n/a | pass |
| 1280 | pass | pass | n/a | pass |
| 1440 | pass | pass | n/a | pass |

Overflow is asserted by **attempting the scroll** (`window.scrollTo(9999, y)` then reading
`scrollX`), not by comparing widths — on `/rates` at 320px `documentElement.scrollWidth`
reported 341 while `document.body.scrollWidth` reported 320, and only trying it settled which
was true.

### Preserved

No change to pricing, money handling, GST, the Prisma schema, any `/api/*` contract, OTP or
session mechanics, password handling, `requireAdmin()` / `requireAdminPage()`, `proxy.ts`'s
404-not-403 rule, or the WhatsApp deep-link builder. The only auth-adjacent change is which
internal path the browser is sent to after a successful sign-in.

---

## Stage 3 — Authentication ✅ COMPLETE

- [x] **10 Auth redirects** — **done in Stage 2.** `lib/auth/safe-next.ts`, applied to login,
      signup and forgot-password. Fixes C-3, closes UI_REDESIGN_DEBT-002.
- [x] **11 Signed-in bounce** — `redirectIfSignedIn()` on `/login` and `/signup`, resolving
      the real session rather than the cookie. **Fixes C-4**, the last open navigation
      finding. D-067.
      - [x] `/forgot-password` deliberately NOT bounced — resetting while signed in is
            legitimate, and it stays statically rendered as a result
      - [x] `?next=` pointing at an auth route can no longer loop (D-068)
      - [x] A **stale** cookie falls through to the form; asserted by test
- [x] **12 Auth screens**
      - [x] `AuthShell` — the `Card` is gone. Hierarchy from a Playfair `h1`, one muted line
            and whitespace; fields are white on cream. Brief §5.
      - [x] **"Back to the shop"** — brief §13. The only previous exit was the browser button.
      - [x] `StepIndicator` — signup is three screens that each look complete (brief §6)
      - [x] `FormError` — icon + ring, so the state is not carried by colour alone (§16)
      - [x] Password hints now read `MIN_PASSWORD_LENGTH` from the policy the **server**
            enforces, so the copy cannot drift from the rule
      - [x] `OtpInput` needed no structural change — paste, backspace, arrow keys,
            `one-time-code` and `inputMode="numeric"` were already right
- [x] **13 Sign-out** — "Signed out" toast, quiet text buttons instead of a card with two
      full-width blocks. **Fixes C-7.** Both controls verified at 44px.

### Shared-primitive work (brief §19: fix the component, not the page)

- [x] `Button` gains `loadingLabel` — "Signing in…", "Verifying…", "Creating account…".
      A spinner beside an unchanged label says nothing to a screen reader, which announces
      only the label.
- [x] `Spinner` gains `decorative` — inside a `Button` it no longer nests a `role="status"`
      live region or prepends "Loading" to the button's accessible name.

### Two real bugs found

- **Double-submit on every OTP verify button.** `disabled={disabled ?? loading}` — and
  `false ?? true` is `false`, so `loading={busy} disabled={code.length < 6}` left the button
  **live** the moment the sixth digit landed. Five call sites, including all three OTP verify
  buttons. Two verifications means two attempts spent against the 6-attempt lockout. Now
  `disabled || loading`, pinned by a unit test.
- **Every loading button announced "Loading &lt;label&gt;".** `Spinner` is `role="status"`
  with `aria-label="Loading"`, which is right standalone and wrong inside a control that
  already carries `aria-busy`.

### Stage 3 verification

| Gate | Result |
| :--- | :--- |
| `pnpm lint` / `typecheck` / `build` | pass |
| `pnpm test` (unit) | **1312 passed**, 7 skipped |
| `e2e/auth.spec.ts` | 27 passed |
| Full Playwright suite | **654 passed, 0 failed**, 193 skipped |
| axe / screen-reader / keyboard | pass — all three suites already cover `/login`, `/signup`, `/forgot-password` |

Responsive: `/login`, `/signup`, `/forgot-password` and the OTP step verified at **320 / 360
/ 390 / 414**, asserting real scrollability and 44px targets. Auth layout is a single column
and does not change shape above 414, so the wide widths are covered by the shell suite.

### Preserved

No change to OTP generation, hashing, TTL, attempt limits or rate limiting; password hashing;
sessions or cookies; `proxy.ts`; `requireAdmin()`; password-reset security; account claiming;
API contracts; or the schema. The enumeration-safe generic error is unchanged and asserted.

### Deferred

- **`/claim/[token]`** — an auth-adjacent flow living in the `(app)` group with the storefront
  shell. Left alone: it is reached from a WhatsApp link rather than from the auth screens, and
  restyling it means touching order-claim UI, which is Stage 4's. UI_REDESIGN_DEBT-006.
- **Success interstitials** (brief §15) — signup and reset redirect straight to the
  destination. Brief §10 also says not to add an unnecessary intermediate page; the toast
  carries the confirmation instead.

---

## Stage 4 — Storefront

- [ ] **14 Homepage hero** — `[!]` **blocked on B-2.** Wine hero, serif headline, one word in
      `rose` at **display size only** (§E). Real `h1` replaces the `sr-only` one — then
      **re-measure the ticker's fold position at 375px**, which is a standing acceptance
      criterion (C-10).
- [ ] **15 HeroMedia** — poster-first, video after, reduced-motion aware, never blocks first
      paint. Ships with `videoSrc` optional and unset — the schema has no video column
      (UI_REDESIGN_DEBT-001).
- [x] **16 LiveRateCard** — **Stage 4B.** New shared component replacing `RateTicker`'s
      presentation; used by `/` and `/rates`. All three metals at once with 22K as the anchor
      (D-069), rose sparkline, units always visible, `.num` throughout. Rate maths, the cache
      window and the true-rate provenance are untouched.
      - [x] `rate-ticker.tsx` and `rate-card.tsx` deleted — §19's "no duplicate rate cards"
      - [x] Jitter narrowed to the anchor; screen readers still get the TRUE rate
      - [x] Refresh control wired to SWR `mutate()` — a real revalidation, not decoration
- [x] **17 Rates page** — **Stage 4B.** Playfair heading, one `LiveRateCard`, 30-day history
      with **stacked records on mobile and a table from `md`** (§14), wine calculator CTA.
      - [!] **Range selector NOT built** — the shop has 3 days of history, so 1W/1M/6M/1Y all
            return the same points. UI_REDESIGN_DEBT-007, D-070.
- [x] **18 Homepage sections** — **4A.** Hero, rates, disclaimer (carried by the rate card),
      new arrivals, collections, wine trust band. Trust claims are only ones the shop keeps:
      the reference's "Live Updated Rates" is replaced by "Rates updated daily".
- [x] **19 Product listing** — **4C.** `ProductCard` loses its card surface, price moves above
      purity/weight, 1.03 hover push-in cropped so nothing resizes. 2-up at 390px. D-072.
- [x] **20 Product detail** — **4C.** Playfair name, editorial gallery, `buttonClasses` on the
      calculator link, `display` heading on related products. `--sticky-bar-height` untouched.
- [x] **21 Calculator** — **4D.** Playfair heading, `.num` on the total, and the breakdown now
      splits metal / making / stone / GST / total. `ItemCard` and `ItemList` left structurally
      alone — §8.1 shares them with the admin bill builder. D-073.
- [x] **22 Account** — **4E.** `display` heading; the quiet sign-out and the C-3 admin
      shortcut shipped in Stage 3.
- [x] **23 Orders** — **4E.** Playfair heading, `.num`, and a "Cancelled" badge from
      `voidedAt`. No invented statuses — there is no fulfilment pipeline. D-075.

---

## Stage 5 — Admin

### 5A — shell, navigation, wayfinding ✅ COMPLETE

- [x] **Route inventory** — `specs/ROUTE-MAP.md`: every route, how it is protected, how it is
      reached. Enumerated from `app/` on disk, with authorisation read from the code that
      enforces it rather than from where a link appears.
- [x] **Desktop rail** — all eight destinations + "Back to shop". Already shipped in Stage 2
      (D-059); 5A verified it and relabelled two entries.
- [x] **Mobile drawer** — now the COMPLETE menu, not the overflow (D-077). Trigger renamed
      "All admin pages"; bottom bar keeps the four daily destinations as the fast path.
- [x] **"Bills & orders"** — truthful about `/admin/bills`; no invented `/admin/orders`
      (D-078, DEBT-004).
- [x] **Admin header compacted** — the generic "Shop admin" line removed; every page already
      has its own `h1` (D-079).
- [x] **Back to shop** — relabelled from "Back to site" per §9, in both the rail and drawer.
- [x] **Storefront → admin** — the `/account` shortcut from Stage 3 (C-3), admin-only.
- [x] **Admin bottom bar made opaque** — same contrast reasoning as D-076.

**5A verification**

| Gate | Result |
| :--- | :--- |
| `pnpm lint` / `typecheck` | pass |
| `lib/navigation.test.ts` | 56 assertions |
| `e2e/admin-shell.spec.ts` (new) | 25 passed |
| `navigation` / `admin` specs | 92 passed |
| `a11y` / `keyboard` / `screen-reader` / `responsive` | 227 → 120 passed after relabelling |

Security verified as behaviour, not markup: a signed-in **customer** gets `404` from all
eight admin routes and sees no `/admin` link anywhere; a signed-out visitor gets `404`.
Navigation is convenience only.

Responsive: `/admin` measured at 320 / 390 / 1440 — no horizontal scroll; all five bottom-bar
targets ≥44px.

**Not done in 5A, on purpose:** dashboard, rates, products, media, bills, settings, audit and
the bill PDF are 5B–5G.

### 5B — dashboard ✅ COMPLETE

- [x] **Primary action** — "Set today's rates" is the page's one accent button. §7.2 calls it
      the most frequent daily action; it had been a corner text link (D-082).
- [x] **Rates panel** — units per face (§13), and freshness as a date, with a badge only for
      the stale exception rather than a green tick on every row (D-083).
- [x] **Hierarchy over a tile wall** — "sold today" is the anchor, larger **from `sm` only**
      so DEBT-038's 375px overflow test still measures what it measured (D-082).
- [x] **Two alerts that existed in the data and had never been shown** — unsent bills and
      unclaimed orders, computed by `getSalesTotals()` since Phase 8 (D-081).
- [x] **"More" card removed** — it duplicated the rail and drawer 5A built (D-084, §10).
- [x] **Empty states** — recent orders offers "Create the first bill"; the chart says "no
      sales recorded yet"; alerts render only when there is something to act on.
- [x] **Bottom-bar `shortLabel`** — "Bills & orders" dropped its second line out of the 64px
      row at 320px. Measured, then abbreviated to "Bills" in the bar only.
- [x] **No `loading.tsx` for `/admin`** — it would turn every admin 404 into a 200 (D-085).

**No invented data.** Every figure comes from a source that already existed: `getCurrentRates`,
`getSalesTotals`, order/enquiry counts, the 30-day SQL series, and the products-without-images
count. No revenue, conversion, growth or customer metric was added.

**5B verification**

| Gate | Result |
| :--- | :--- |
| `pnpm lint` / `typecheck` / `build` | pass |
| `e2e/admin.spec.ts` + `admin-shell.spec.ts` | 63 passed |
| `a11y` + `responsive` | 120 passed |

Visual check at **320 / 390 / 1440** — no horizontal scroll; money tiles stay full width on
mobile per D-036; all five bottom-bar targets 63px.

**Not done in 5B:** rates, products, media, bills, settings, audit and the bill PDF are 5C–5G.

### 5C — admin rates ✅ COMPLETE

- [x] **Current → new → save** made explicit (D-086). A `CURRENT` eyebrow, the figure, a
      hairline, then `New rate (per 10 grams)` — the largest number on screen used to read
      like the field being edited.
- [x] **Units in both halves** (§6) — on the current figure and in the field label.
- [x] **Stale flagged where it gets fixed** — §7.2's 48-hour rule extracted to
      `lib/admin/rate-freshness.ts` and shared with the dashboard (D-087).
- [x] **Save button changes weight** — `outline` while inert, `primary` when there is a
      change. Three full-strength "No change" bars were the heaviest thing on the page.
- [x] **Loading labels** — "Saving…" on both the save and the confirm action.
- [x] **History redesigned** as a scannable row per change, with an empty state that explains
      what will appear (D-088).
- [x] **Editing column capped** at `max-w-2xl` (§16, D-089).
- [x] **`.num`** on every figure.

**Preserved exactly:** the >20% confirmation naming both figures (§7.3 — "the single most
damaging typo available"), the live % preview, `inputMode="decimal"`, Zod validation, the
server action, `setRate`'s audit write and cache busting. Verified live at 320px: a 567%
change was refused and the stored rate was unchanged afterwards.

**5C verification**

| Gate | Result |
| :--- | :--- |
| `pnpm lint` / `typecheck` / `build` | pass |
| `admin` + `admin-shell` + `a11y` specs | 150 passed |
| `lib/admin` + `lib/rates` unit | 128 passed |

Visual check at **320 / 390 / 1440**, including the confirmation step at 320 — no horizontal
scroll. New debt: UI_REDESIGN_DEBT-009 (₹ renders after the number in the rate field).

**Not done in 5C:** products, media, bills, settings, audit and the bill PDF are 5D–5G.

### 5D — admin products + media ✅ COMPLETE

**Products**

- [x] **The list shows the piece** (§2, D-090) — a fixed-ratio 96px thumbnail, purity, weight
      with its unit, price, and only the badges that are true. Phase 7 counted the images
      without ever selecting one.
- [x] **The price is the shop's price** (D-091) — `priceProduct` with the Settings GST, not a
      private helper passing `gstPct: 3`. Labelled once above the column (§10).
- [x] **Filters are legible and reversible** (§3) — visible labels, an active-filter pill per
      applied filter, a matching count and "Clear all". Two selects pair up below `lg` so the
      panel stops eating half a 320px screen.
- [x] **Two empty states** (§21) — "no pieces match" → clear filters; "no pieces yet" → add
      the first.
- [x] **Two columns from `lg`, stacked below** (§6, §7). No table squeezed into 320px.
- [x] **Form grouped identity → the piece → pricing → availability → save** (§8, D-092), with
      hints carrying units and ranges (§9) and a dirty-aware save (§12).
- [x] **Creating ends somewhere** (D-093) — a success panel with **Add photos**, instead of a
      form that would fail on its own slug if pressed twice.
- [x] **Photos**: 96px thumbnails, a **Cover** marker on the first (§19), errors split across
      the three controls that produce them (§11, §17), and no invented upload progress (§16).
- [x] **Removing a photo asks first and names it** (§20, D-094).
- [x] **The switch is its own 44px target** (§23, D-097).

**Media**

- [x] **The screen stops promising places that do not exist** (§15, D-095) — two live slots,
      ten that nothing reads, said in two headed groups. `lib/media/slots.test.ts` fails if
      the flag stops matching the code.
- [x] **Clearing asks first and names the slot** (§20, D-094).
- [x] **Save is inert until something changes** (§12), and **Clear** tracks what is stored now
      rather than what was stored at page load.

**Preserved exactly:** `saveProduct`'s Zod schema and every message, slug uniqueness, the
grams→milligrams and rupees→paise integer conversions, the soft-delete-only rule and its §7.4
note, `checkImageUrl`/SSRF, the signed direct-to-Cloudinary upload and its field list, the
server-side re-verification, `sortOrder` reordering, and every audit write.

**5D verification**

| Gate | Result |
| :--- | :--- |
| `pnpm lint` / `typecheck` / `build` | pass |
| `admin` + `admin-shell` + `a11y` specs | 150 passed |
| new `e2e/admin-products.spec.ts` | 34 passed |
| `lib/admin` + `lib/media` + `lib/catalog` unit | 232 passed, + 14 new in `slots.test.ts` |

Measured at **320 / 390 / 1440** on the list, the create form, an edit page and the media
screen: `scrollX === 0` everywhere, and every button, link and switch inside `main` at 320px
is ≥44×44. Both confirmation strips fit at 320px.

Fixed on the way past: `e2e/a11y.spec.ts`'s "product editor" scan had been scanning
`/admin/products/new` since Phase 7 (D-096).

New debt: UI_REDESIGN_DEBT-010 (four purity label maps), 011 (ten dead media slots), 012 (no
unsaved-changes guard), 013 (`bulkUpdateProducts` has no UI), 014 (a collection's image cannot
be set anywhere).

**Not done in 5D:** bills, settings, audit and the bill PDF are 5E–5G.

### 5E — admin bills & orders ✅ COMPLETE

**A defect, found and fixed (D-098)**

Searching the invoice book by **customer name returned every bill in the shop**.
`billsWhere` built `customerPhone: { contains: q.replace(/\D/g, '') }`, which is
`contains: ''` for any term without a digit — `LIKE '%%'`, true for every row. Measured
against the real database first: `q=zzzznotabill` matched **120 of 120** active orders. The
same function backs the accountant's CSV, so that export was the whole ledger too. Fixed under
§3, with the assertion on the shape of the `where` rather than on a fixture count.

**Bills list**

- [x] **Rows answer §1's questions** — invoice number, total (largest thing on the row),
      customer *and* their number, item count, date, status, and a chevron because opening the
      bill is the action.
- [x] **Badges mark exceptions only** (§5, D-099) — Void and Not sent. "Sent" and "Claimed"
      are quiet text. Every badge carries text and an icon, never colour alone.
- [x] **Filters fold away** (§6, D-100) — search stays visible, five refinements sit in a
      native `<details>` that still submits while closed and opens itself on a filtered view.
- [x] **Applied filters are removable pills** with a matching count and Clear all.
- [x] **Two empty states** (§20) — an empty book offers "Create the first bill"; an empty
      search offers "Clear filters".
- [x] **A real pager** with "page N of M" between the two controls.

**Bill detail**

- [x] **§7's full hierarchy** — identity → total → customer → items → rate snapshot → charges
      → GST → total → actions.
- [x] **The total is unmissable** (§9) — its own card, `md:text-display`, with the amount in
      words underneath.
- [x] **Items show where the money went** (§8, D-101) — purity as "22K (916)" rather than the
      raw enum "K22 916", weight and the *snapshotted* rate with units, then metal value,
      making, stones, taxable and GST per line.
- [x] **The rate snapshot is on the screen** (§7) — it was on the invoice and nowhere else.
- [x] **Charges reconcile** and no zero-value category is invented (§9).
- [x] **A corrupt bill degrades instead of 500ing** (D-102), with a second guard that hides
      the components unless they sum to the stored taxable value.
- [x] **`<a><Button/></a>` unnested** — the PDF link is an anchor wearing `buttonClasses`.

**Bill creation**

- [x] **Numbered stages** (§11, D-103) — customer → rates → items → review, the sequence
      unchanged.
- [x] **The rate being used is visible** (§13) — the builder always fetched it and never
      showed it.
- [x] **A review before Create** (§14) from `summariseTotal`, the function whose parts are
      already proven to reconcile with its whole.
- [x] **Incomplete says so** (§12) — "no mobile number yet" in the review, plus a list of what
      Generate is waiting for.
- [x] **The duplicate-bill window is closed** (§13, D-104) — Generate stays disabled through
      the navigation, where it used to re-enable *after* the idempotency key had rotated.

**Destructive**

- [x] **Voiding names the bill, the customer and the amount** (§19, D-105). Reason still
      required, still a soft void, still no delete anywhere.

**Preserved exactly:** every figure in `lib/pricing.ts` and `lib/bills/totals.ts`, the
CGST/SGST split, the `ratePerGram`/`makingPct`/`gstPct` snapshots, `createBill`, the invoice
sequence, the idempotency key, `/api/admin/bills`, the signed PDF URL and its expiry, the
WhatsApp deep link and its claim URL, `markBillSent`'s refusal to record optimistically,
`voidBill`, `regenerateBillPdf`, the CSV export, and every PDF style (5G).

**5E verification**

| Gate | Result |
| :--- | :--- |
| `pnpm lint` / `typecheck` / `build` | pass |
| `bills` + `claim` + `a11y` + `admin` + `admin-shell` + `admin-products` | 205 passed |
| new `e2e/admin-bills.spec.ts` | 40 passed |
| `lib/bills` unit | 129 passed (+10 new in `split-line.test.ts`, +4 in `query.test.ts`) |

Measured at **320 / 390 / 1440** across the list, the builder and a bill: `scrollX === 0`
everywhere, every button/link/summary inside `main` at 320px is ≥44×44, and the sticky total
bar bottoms out at exactly the nav's top edge (736px in an 800px viewport) with Generate 16px
clear of it. The void confirmation was opened at 320px, checked, and dismissed — no bill was
voided.

**Not done in 5E:** settings, audit and the bill PDF are 5F–5G.

### 5F — settings, audit & collections ✅ COMPLETE

**A three-year-old gap, closed (D-109)**

UI_REDESIGN_DEBT-014: `Category.imageUrl` has been selected by the homepage since Phase 3 and
written by nothing, so every collection tile on the storefront rendered the branded monogram
permanently with no admin route to change it. §8 asked whether the fix was UI exposure or
missing infrastructure — it was UI exposure. The URL goes through `checkImageUrl`, the same
§7.7 guard product images and media slots use. No new media architecture.

`imageUrl` is a three-state field: `undefined` leaves it alone, `''` clears it, a URL is
validated and the **verified** result stored. The first of those is load-bearing — the
visibility toggle does not send the field, and treating it as "clear" would delete a picture
every time somebody hid a collection.

**Settings**

- [x] **Five groups, each saying what it governs** (§3, D-111) — Phase 7 was a stack of bare
      labels on a screen that sets what customers are charged.
- [x] **Units and effects explicit** (§4) — GST and making carry their range and their reach.
- [x] **High-impact fields warn only while being changed** (§6) — GST names both percentages;
      the invoice sequence says that moving it backwards can reissue a number already on a
      customer's invoice.
- [x] **A live preview of the next invoice number.**
- [x] **Unconfigured is explicit** (§7) — "Not set. Your invoices are printing without a
      GSTIN." The WhatsApp number says when it is the site's built-in fallback rather than a
      saved value.
- [x] **Dirty-aware save** (§5) that still requires the password, and says which of the two is
      missing instead of leaving a dead control.
- [x] **`billSequence` is a string in form state** — it was `Number(v) || 1`, so clearing the
      field to retype snapped back to `1`.

**Collections**

- [x] **Rename and web address reachable** (D-110) — `saveCategory` has taken both since
      Phase 7 and the only caller passed the existing values back.
- [x] **Image managed from the row** (§9), with a preview and a checked URL.
- [x] **Removing an image names the collection** (§12); **deleting names it too** (§6) and
      says which of the two outcomes applies.
- [x] **The row shows the name again** (D-113) — at 320px `truncate` had been hiding it
      entirely. Found by a screenshot; every geometry assertion passed throughout.

**Audit**

- [x] **The filter stopped narrowing its own vocabulary** (§15, D-106) — both lists were built
      from the rows already on screen, so filtering to one action left it as the only option.
- [x] **"What changed" is answered** (§13, §16, D-107) — `before`/`after` had been written
      since Phase 7 and rendered nowhere. A bounded diff, not raw JSON.
- [x] **Human labels beside the stored constants** (§14) — nothing renamed;
      `lib/admin/audit-labels.test.ts` scans the repo in both directions.
- [x] **Paged** (§18, D-108) — `take: 200` with no pager and no sign it had stopped.
- [x] **Read-only, and it says so** (§17). No edit, delete or clear control exists.
- [x] **Dense rows, not a card per event** (§19) — the other two screens are things you edit;
      this is a ledger you read.

**Also:** the "← More" back link pointing at `/admin/media` is gone from all three pages
(D-112).

**Preserved exactly:** `saveSettings`'s schema, re-authentication, audit entry and both cache
invalidations; `deleteCategory`'s block with its count and its way out; `reorderCategories`;
audit recording semantics; every event name.

**5F verification**

| Gate | Result |
| :--- | :--- |
| `pnpm lint` / `typecheck` / `build` | pass |
| `admin` + `a11y` + `admin-shell` + `admin-settings` + `admin-products` + `admin-bills` | 258 passed |
| new `e2e/admin-settings.spec.ts` | 46 passed |
| `lib/admin` + `lib/settings` + `lib/media` unit | 196 passed (+30 in `audit-labels.test.ts`, +4 category-image cases) |

Measured at **320 / 390 / 1440** on all three screens: `scrollX === 0` everywhere and every
button, link, summary and switch inside `main` at 320px is ≥44×44 — with a category editor
open, so its controls were measured too. Nothing was written: the settings password is wrong
on purpose, and both confirmations were opened and dismissed.

New debt: UI_REDESIGN_DEBT-015 (the audit log has no actor filter — §7.10 asks for one, and
§15 forbids inventing the backend for it).

**Not done in 5F:** the bill PDF is 5G.

### 5G — bill PDF visual cleanup ✅ COMPLETE

**The palette, by count**

`muted` ×16 · `ink` ×4 · `wine` ×3 · `down` ×2 · `white` ×1.
**Rose, roseTint, cream and gold do not appear on the invoice at all** (D-114).

Wine is used three times, each structurally: the TAX INVOICE label, the rule under the table
head, the rule above the grand total.

- [x] **The rules are visible on paper** (§18) — `roseTint` (1.04:1 on white) and `line`
      (1.06:1) carried every rule and both cream panel fills rendered as nothing. Rules are
      now `muted` at 0.4 / 0.6 / 1.2pt; the panel fills are gone.
- [x] **The grand total is type, not a box** (§11, D-115) — a wine rule and 15pt bold ink in
      place of a filled `roseTint` panel.
- [x] **The charges break down** (§10, D-116) — Metal value / Making charges / Stones, summed
      by `buildBillData` from the per-line split it already produces, and **null unless they
      reconcile with the stored taxable total**. No zero rows.
- [x] **The stone column disappears when nothing has one** (§8, D-117), and the money columns
      were rebalanced after a ₹1.2-crore render showed MAKING and STONE reading as one run of
      digits.
- [x] **The money columns say their unit** (§9, D-118) — `ITEMS · ALL AMOUNTS IN RUPEES`,
      because only the last header carried `(RS.)`.
- [x] **Multi-page invoices are asserted** (§15, D-120) — table head and footer on every page,
      grand total exactly once on the page that prints `Page N of N`.
- [x] **Tabular figures** (§8) — Helvetica's digits are all 556 units wide, so the base-14
      metrics already provide it.

**Unchanged, and verified unchanged:** every figure on the page. `formatRupeesAscii` and
`formatAmountDigits` are the same formatters; `splitStoredLine` still refuses to print a bill
that disagrees with its own snapshot; GST is still `splitGst` over the stored `gstAmount`;
the rate reference still comes from `ratesSnapshot`; the void stamp, the amount in words, the
buyback text and the page numbering are untouched. No page size, margin or font change.

**There is no QR code** (§13, D-119). Nothing in the repository generates or verifies one —
the only verification artefact is the signed, expiring URL the PDF is served from, which is a
capability credential and must not be printed. Recorded as UI_REDESIGN_DEBT-016 rather than
invented.

**5G verification**

| Gate | Result |
| :--- | :--- |
| `pnpm lint` / `typecheck` / `build` | pass |
| `lib/bills` + `lib/money` + `lib/pricing` unit | 228 passed (+2 new PDF assertions) |
| `e2e/bills.spec.ts` + `e2e/claim.spec.ts` | 29 passed |
| `e2e/admin-bills.spec.ts` | 40 passed |

**Manual PDF review** — five invoices rendered and inspected: one item with hallmark and BIS,
five items across three purities with a stone charge, a 67-character product name with a
37-character customer name at ₹1.2 crore, a voided bill, and a 20-item bill that spills to a
second page. No clipping, no overlap, no text outside its container.

New debt: UI_REDESIGN_DEBT-016 (no QR), UI_REDESIGN_DEBT-017 — the three bill E2E suites pass
individually but return **429** when run together, because `/admin/bills*` matches the 60/min
`bill` tier in `lib/security/global-limit.ts` and every worker shares one IP. The application
is behaving correctly; the CI parallelism is what needs tuning at Stage 6, and the limiter
must not be loosened to make it green.

**Stage 5 is complete.** 5A–5G done; the final full-suite run and the Stage 5 PR are next.








- [x] **24 Admin shell** — **done in Stage 2.** Desktop rail, phone bottom bar + "More"
      sheet, all eight destinations, "← Back to site". Fixes C-5 and C-6. D-063.
- [ ] **25 Admin dashboard** — today's rates, set-rate primary action, bills this week, value
      billed, unclaimed orders.
- [ ] **26 Admin rates / products / orders / bills / media / categories / settings / audit** —
      re-skin. Desktop tables, mobile stacked cards. **Zero changes to bill maths, rate
      conversion, or `requireAdmin()`.**
- [ ] **27 Bill PDF** — leave visually quiet. Deliberately *not* the storefront aesthetic
      (brief §19). Verify with `pnpm verify:bill`.

---

## Stage 6 — Verification

- [ ] **28 Empty / error / loading states** — every route, no dead ends
- [ ] **29 Accessibility** — `pnpm test:e2e e2e/a11y.spec.ts`, `keyboard.spec.ts`,
      `screen-reader.spec.ts`. The new palette must clear `axe` **as rendered**, which is how
      Phase 9 §9.7 found failures that isolated pair-checking had missed.
- [ ] **30 Responsive QA** — the SHELL is covered at all eight widths by
      `e2e/responsive.spec.ts` (Stage 2). What remains for Stage 6 is page CONTENT at those
      widths, once Stages 4–5 have restyled it.
- [ ] **31 Route QA** — every route reachable by link; refresh, back-nav, auth behaviour
- [ ] **32 Flow QA** — auth, admin, calculator, WhatsApp enquiry, billing
- [ ] **33 `pnpm lint`**
- [ ] **34 `pnpm typecheck`**
- [ ] **35 `pnpm build`**
- [ ] **36 `pnpm test`** (~615 unit tests)
- [ ] **37 `pnpm test:e2e`** (16 specs)
- [ ] **38 Final visual audit** against brief §35

---

## Sequencing notes

**Stage 1 must land before anything else.** Every later stage consumes those tokens; doing
them out of order means restyling twice.

**Stages 2 and 3 are the honest bug-fix work** — C-1 through C-7 are real defects that exist
independently of the redesign. They are worth shipping even if the visual direction changes.

**Stage 4 carries the brief's actual ambition** and is the only stage gated on the missing
reference image — and only item 14 within it.

**Do not start Stage 4 before Stage 1 is signed off.** Building a wine hero on cream tokens
means building it twice.
