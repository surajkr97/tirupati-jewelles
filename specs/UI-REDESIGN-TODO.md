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
- [x] **08 Footer** — **not restyled.** It already consumes the Stage 1 tokens and its links
      all resolve. A wine footer belongs with the wine hero and trust band in Stage 4; doing
      it here would have been a visual change with no defect behind it.
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

## Stage 3 — Authentication

- [x] **10 Auth redirects** — **done in Stage 2.** `lib/auth/safe-next.ts`, applied to login,
      signup and forgot-password. Fixes C-3, closes UI_REDESIGN_DEBT-002.
- [ ] **11 Signed-in bounce** — send authenticated visitors away from `/login` and `/signup`.
      **Fixes C-4.** Keep it in the pages, not `proxy.ts` — the proxy sees only a cookie, not
      a role, and must not become a second authorisation path.
- [ ] **12 Auth screens** — re-skin `AuthShell`, `OtpInput`, `FormError`. OTP keeps loading /
      error / expired / resend / success. **Security behaviour unchanged**: one generic error
      for every failure mode.
- [ ] **13 Sign-out** — "Signed out" toast; quiet destructive styling (C-7, brief §17).

---

## Stage 4 — Storefront

- [ ] **14 Homepage hero** — `[!]` **blocked on B-2.** Wine hero, serif headline, one word in
      `rose` at **display size only** (§E). Real `h1` replaces the `sr-only` one — then
      **re-measure the ticker's fold position at 375px**, which is a standing acceptance
      criterion (C-10).
- [ ] **15 HeroMedia** — poster-first, video after, reduced-motion aware, never blocks first
      paint. Ships with `videoSrc` optional and unset — the schema has no video column
      (UI_REDESIGN_DEBT-001).
- [ ] **16 LiveRateCard** — restyle `RateTicker` + `Sparkline`. Rose chart stroke, thin. Units
      stay visible. Reused by `/` and `/rates`. Do not touch rate maths or the cache window.
- [ ] **17 Rates page** — range selector 1W/1M/6M/1Y, history chart + table, disclaimer,
      calculator CTA.
- [ ] **18 Homepage sections** — disclaimer, new arrivals, trust band (wine, restrained, small
      type — not an icon grid).
- [ ] **19 Product listing** — `ProductCard` re-skin; whole card navigates; 2-up at 390px.
- [ ] **20 Product detail** — gallery, breakdown, sticky enquiry bar.
      **Do not hardcode `--sticky-bar-height`** — audit §H.
- [ ] **21 Calculator** — re-skin only. Reducer, pricing and share logic untouched.
- [ ] **22 Account** — quiet sign-out, real empty states. (The **admin shortcut link** for
      C-3 shipped in Stage 2; the rest of this item is still Stage 4's.)
- [ ] **23 Orders** — list + detail re-skin.

---

## Stage 5 — Admin

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
