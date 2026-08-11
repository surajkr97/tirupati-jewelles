# UI REDESIGN — AUDIT

**Status:** audit complete, no implementation started.
**Method:** read every route, layout, shell component and design primitive in the repo;
measured the proposed palette with the repository's own `contrastRatio()`; verified each
claimed defect by reading the code that would cause it rather than assuming it.

---

## 0. What this repository actually is — read this first

The redesign brief is written as though this were a template-grade site with hardcoded
colours, missing navigation and broken auth. **It is not.** This is a nine-phase, signed-off
build: 73 commits, ~615 unit tests, 16 Playwright specs including `a11y.spec.ts`,
`screen-reader.spec.ts` and `keyboard.spec.ts`, an automated token-contrast gate
(`lib/design/contrast.test.ts`), and a custom ESLint rule banning off-scale spacing.

Measured, not assumed:

| Brief's assumption | Reality |
| :--- | :--- |
| "hardcoded colors" | **One** hex outside `globals.css` — `app/layout.tsx:77` `themeColor: '#FAF7F4'`, which PWA metadata requires as a literal. Not a defect. |
| "duplicate button styles" | One `cva` primitive in `components/ui/button.tsx`. Two link-styled exceptions exist (homepage CTA, footer WhatsApp) and are commented as deliberate. |
| "arbitrary border radius values" | Four radius tokens, no arbitrary radii anywhere. |
| "inconsistent spacing" | Tailwind's default scale is **disabled** in `globals.css:71`; off-scale values are an ESLint error. |
| "missing empty states" | `EmptyState` primitive exists and is used on 6 surfaces. |

So the honest scope is **not** "fix a broken site". It is: **re-skin a disciplined system
from cream/taupe to wine/rose, add the editorial layer it never had (hero, display serif,
trust section), and close a real but short list of navigation, auth-routing and
route-state gaps.**

Treating this as a rewrite would destroy more value than it creates. Every finding below is
scoped to be a change *within* the existing system, not a replacement of it.

---

## A. Existing routes

Rendered pages. Route handlers (`/api/*`, `/bills/[key]`, `/robots.txt`, `/sitemap.xml`)
are excluded — they have no UI.

### Storefront — `app/(app)/`

| Route | Purpose | Current state | Problems | Priority |
| :--- | :--- | :--- | :--- | :--- |
| `/` | Homepage | ISR 300s. Hero `ImageFrame` (static image, no headline), rate ticker, collections grid, calculator card | **No visible `h1`** — it is `sr-only:100`. No hero headline, no CTA, no copy, no new-arrivals, no trust section. Hero is a bare 16:9 image. This is the single biggest gap vs. the brief | **P0** |
| `/rates` | Full rate experience | Current rates, history table, disclaimer | Reachable on desktop **only via footer** (see C-1) | P1 |
| `/calculator` | Multi-item calculator | Suspense + skeleton, sticky total bar, WhatsApp send | Functionally complete; visual re-skin only | P2 |
| `/calculator/s/[slug]` | Shared estimate | Read-only estimate from share link | No `not-found` UI for a dead slug (C-2) | P2 |
| `/collections` | Category index | Grid of categories | Re-skin only | P2 |
| `/collections/[slug]` | Product listing | Grid + filter sheet + `EmptyState` | Re-skin only | P1 |
| `/products/[slug]` | Product detail | Gallery, price breakdown, trust block, sticky enquiry bar | Sticky bar height is measured and published as `--sticky-bar-height` — **do not hardcode it**; a prior bug was fixed here (`dbc97d4`) | P1 |
| `/search` | Search | Search box + `EmptyState` | Re-skin only | P2 |
| `/policies/[slug]` | Legal + buyback pages | DB-backed, `revalidate: 600` | Re-skin only | P3 |
| `/account` | Profile | Badges, phone-verify card, sign-out | **No link to `/admin` for admins** (C-3). Sign-out is a full card with two buttons — brief §17 wants a quiet destructive action | **P0** |
| `/account/orders` | Order history | `EmptyState` present | Re-skin only | P2 |
| `/account/orders/[id]` | Order detail | Line items, bill link | Re-skin only | P2 |
| `/claim/[token]` | Claim an order via OTP | Claim card | Re-skin only | P2 |

### Auth — `app/(auth)/`

| Route | Purpose | Current state | Problems | Priority |
| :--- | :--- | :--- | :--- | :--- |
| `/login` | Sign in | `AuthShell`, Suspense-wrapped form, in-form errors, button loading state | Never routes an admin to `/admin` (C-3). Signed-in visitors are **not** bounced away (C-4) | **P0** |
| `/signup` | Email → OTP → password | `AuthShell`, `OtpInput` | Same two problems; also ignores `?next=` | **P0** |
| `/forgot-password` | Reset via OTP | Two-step in one page, redirects to `/account` | Ignores `?next=`; admin lands on `/account`. **No separate reset page is needed** — verified, this is a complete flow | P2 |

### Admin — `app/admin/`

| Route | Purpose | Current state | Problems | Priority |
| :--- | :--- | :--- | :--- | :--- |
| `/admin` | Dashboard | Today's rates, quick actions | Re-skin; brief §18 wants bills-this-week / value-billed / unclaimed-orders tiles | P1 |
| `/admin/rates` | Set rates | `RateEditor` | Re-skin only | P1 |
| `/admin/products` `/new` `/[id]` | Product CRUD | Forms, image manager | Re-skin only | P2 |
| `/admin/bills` `/new` `/[id]` | Bill builder | `BillBuilder`, actions | **Do not touch the money path** | P2 |
| `/admin/categories` | Category CRUD | Manager | Linked only from `/admin/products/new` | P3 |
| `/admin/media` | Media slots | Slot cards | Labelled "More" in the nav — misleading | P2 |
| `/admin/settings` | Shop settings | Settings form | **Zero inbound links — URL must be typed** (C-5) | **P0** |
| `/admin/audit` | Audit log | Log table | **Zero inbound links — URL must be typed** (C-5) | **P0** |

### Dev-only

`/__design` (component gallery) and `/__sentry-check` — rewritten to a 404 in production by
`proxy.ts:78`. `/__design` is a genuine asset for this redesign: it is where new primitives
should be proved before they reach a page.

**No `/about` and no `/contact` route exists.** Brief §20 asks the footer to link both. See
C-9 — do not invent the hrefs.

---

## B. Existing user flows

### Visitor
`/` → ticker → `/collections` → `/collections/[slug]` → `/products/[slug]` → sticky
"Enquire on WhatsApp" → `wa.me` deep link. **No checkout, by design (MASTER-SPEC §1).**

*Where it breaks:* the homepage never says what the business is or why to trust it — there
is no headline, no positioning copy, no trust section above the footer. A first-time visitor
lands on an unlabelled photo and a rate widget. On desktop the journey depends on the footer
because the header has no navigation.

### Customer
`/login` (or `/signup` → OTP) → `/account` → `/account/orders` → `/account/orders/[id]`.
Unverified phone → `VerifyPhoneCard` → OTP → past orders attach via `countClaimableOrders`.

*Where it breaks:* an admin using this same flow is deposited on `/account` with an "Admin"
badge and no way onward. Signing in while already signed in re-renders the form.

### Admin
`/login` → **`/account`** → *dead end* → user types `/admin` manually.

*Where it breaks:* this is the flow the brief calls out and it is **confirmed real**.
`login-form.tsx:47` hardcodes the fallback to `/account` with no role branch, and
`app/(app)/account/page.tsx:52` renders the admin badge as a `<Badge>`, not a `<Link>`.
Once inside `/admin` there is no way back to the storefront, and two admin routes have no
inbound link at all.

### Calculator
`/calculator` → segmented metal/purity → weight + making charge → add item → item list →
sticky total → WhatsApp. Shareable via `/calculator/s/[slug]`.

*Where it breaks:* nothing structural. This flow is in good shape and needs re-skinning only.

---

## C. Broken UX — confirmed findings

Each was verified by reading the responsible code. Line references are current as of this
audit.

**C-1 — No desktop primary navigation. (HIGH)**
`components/shell/bottom-nav.tsx:38` is `md:hidden`, and `components/shell/app-header.tsx`
renders only a logo, search icon and account icon. At ≥768px there is **no** nav to Rates,
Calculator or Collections outside the footer. Users must scroll to the bottom of the page to
move around the site. This is the largest navigation defect and it maps directly onto brief
§10's desktop header requirement.

**C-2 — No `loading.tsx`, `error.tsx` or `not-found.tsx` anywhere. (HIGH)**
Verified: zero such files in `app/`. Consequences — every server-rendered navigation shows
the *previous* page frozen until data resolves; any thrown error renders Next's unstyled
default; every 404 (including the one `proxy.ts:98` deliberately serves to admin probers)
is Next's default black-on-white page. Brief §22 requires all three. This is the biggest
single gap after the homepage.

**C-3 — Admin login lands on `/account` with no route onward. (HIGH)**
`app/(auth)/login/login-form.tsx:45-47`:
```ts
const destination = next?.startsWith('/') && !next.startsWith('//') ? next : '/account';
```
No `role` branch. Brief §11 requires `ADMIN → /admin`. Compounded by
`app/(app)/account/page.tsx:52`, where the admin marker is a non-interactive `<Badge>`.

**C-4 — Signed-in users are not redirected away from `/login` and `/signup`. (MEDIUM)**
`proxy.ts` handles `/admin` and `/account` but has no rule for the auth group, and neither
page checks the session. Brief §11 requires the bounce.

**C-5 — `/admin/settings` and `/admin/audit` are absent from navigation. (MEDIUM)**

> **CORRECTED after Stage 1.** This was first written as "unreachable by link (HIGH)". That
> was wrong. The grep behind it searched for the literal `href="/admin/settings"`, and the
> links are built from an array — `app/admin/page.tsx:292-300` renders a "More" card
> containing Collections, Images, **Settings** and **Audit log**. Both routes are reachable
> without typing a URL. The finding is downgraded, not withdrawn: a search that only matches
> one spelling of a link is not evidence of absence, and it should have been run both ways.

What remains true: `components/admin/admin-nav.tsx:26-32` has five slots and neither route is
among them, so both are reachable only by first returning to the dashboard. Brief §18 lists
them as navigation destinations. The sidebar in D-059 gives them permanent slots.

**Compounding it:** those "More" links were styled `bg-rose-tint/50`, which under the new
palette measures **1.02:1 against cream** — the only route to Settings and Audit would have
become invisible. Fixed in Stage 1 with the rest of the tint flattening (D-058).

**C-6 — No route back to the storefront from `/admin`. (MEDIUM)**
`AdminNav` has no "← Back to site". Brief §18 requires it.

**C-7 — Sign-out gives no confirmation. (LOW)**
`app/(app)/account/account-actions.tsx:29` redirects to `/` on success but only toasts on
*failure*. Brief §11 wants a subtle "Signed out" confirmation.

**C-8 — `AppHeader`'s `overlay` prop is dead code. (LOW)**
`app-header.tsx:15` implements a transparent-over-hero → solid-on-scroll behaviour;
`app/(app)/layout.tsx:56` renders `<AppHeader />` with no props, so `overlay` is never
`true` and the scroll listener never attaches. The wine hero in brief §8 is exactly what
this was built for — wire it rather than rewriting it.

**C-9 — Footer has no About or Contact, and those routes do not exist. (MEDIUM)**
`components/shell/footer.tsx` links Shop (4) and Policies (5). Brief §20 wants About and
Contact. Per the brief's own rule, **do not add a fake href** — either create the pages or
record the omission. Recorded here as a decision the owner must make.

**C-10 — Homepage has no visible `h1`. (MEDIUM)**
`app/(app)/page.tsx:100` deliberately hides it `sr-only`, with a documented reason: Phase 4
made "ticker above the fold at 375px" an acceptance criterion, and a visible headline pushed
it down. **The brief's wine hero resolves this tension** — a hero with a real headline
satisfies both, but the ticker's fold position must be re-measured afterwards, not assumed.

**C-11 — `next` validation admits the backslash form. (LOW — security-adjacent)**
`login-form.tsx:47` rejects `//evil.com` but accepts `/\evil.com`, which several browsers
normalise to a protocol-relative URL. Client-side `router.replace` makes exploitation
unlikely, but the check should reject `\` too. Logged as UI_REDESIGN_DEBT-002.

### Investigated and found NOT broken

Reporting these so nobody spends a day fixing a non-problem:

- **Signup/OTP mechanics** — hashed, TTL'd, single-use, rate-limited per phone and IP.
- **Protected-route redirect** — `proxy.ts:107` sets `?next=` correctly; `/admin` correctly
  404s rather than redirecting (deliberate, `proxy.ts:88`).
- **Password reset** — a complete two-step flow on one page. No missing route.
- **Mobile bottom-nav overlap** — `BottomNavSpacer` and `--spacing-bottom-nav` are a single
  source of truth; the sticky-bar collision was found and fixed in `dbc97d4`.
- **Auth error display** — already in-form via `FormError`, not toast-only.
- **Tap targets / body-text floor** — enforced by tokens (`--spacing-tap`, 15px minimum).
- **Reduced motion** — `globals.css:164` handles it globally.

---

## D. Design inconsistencies

The system is disciplined. The real gaps are **absences**, not inconsistencies.

| # | Finding | Severity |
| :--- | :--- | :--- |
| D-1 | **No display serif.** Only `Inter` is loaded (`app/layout.tsx:9`). Brief §6 requires an editorial serif for headlines — the entire "editorial" direction depends on it. | **HIGH** |
| D-2 | **No `.num` class.** `.tabular` exists (`globals.css:153`) and does the same job. Brief §6 names `.num`. Alias it; do not migrate 40 call sites for a rename. | LOW |
| D-3 | **Palette is cream/taupe, brief wants wine/rose.** The central change. See §E — it does not survive contact with the contrast gate unmodified. | **HIGH** |
| D-4 | **Two link-styled button clones.** `page.tsx:143` and `footer.tsx:66` reproduce accent-button styling by hand because `Button` renders a `<button>`. Fix once by adding `asChild`/`as="a"` to `Button`. | MEDIUM |
| D-5 | **Admin uses a bottom nav on desktop.** Not a defect — `admin-nav.tsx:6-11` argues it deliberately ("the owner is standing in a shop holding a phone"). Brief §18 wants a desktop sidebar. **This is a conflict, not a bug.** See §F. | — |
| D-6 | Icon sizes are consistent (`--spacing-icon`), but `size-4` and `size-6` also appear. Minor; tokenise if touched. | LOW |

---

## E. The proposed palette does not pass the existing contrast gate

**This is the most important finding in the audit.**

`lib/design/contrast.test.ts` fails the build on any token pair below its WCAG threshold.
The current palette reached its values *by measurement* — `taupe` → `taupeDeep` in D-007,
then four more in Phase 9 §9.7 when `axe` measured the palette **as rendered** rather than
as isolated pairs.

I ran the brief's palette through that same `contrastRatio()`. **10 of 26 pairs fail:**

| Pair | Ratio | Needs | Verdict |
| :--- | ---: | ---: | :--- |
| `ink` on cream | 16.32 | 4.5 | pass |
| `inkSoft` on cream | 5.00 | 4.5 | pass |
| **`muted` #8B888F on cream** | **3.27** | 4.5 | **FAIL** |
| **`muted` on white** | **3.49** | 4.5 | **FAIL** |
| **`muted` on `roseTint`** | **3.10** | 4.5 | **FAIL** |
| **`rose` as text on cream** | **3.87** | 4.5 | **FAIL** |
| **`rose` as text on white** | **4.13** | 4.5 | **FAIL** |
| **white on `rose` (button fill)** | **4.13** | 4.5 | **FAIL** |
| **`rose` on `wine` (hero accent word, body size)** | **4.01** | 4.5 | **FAIL** |
| `rose` on `wine` at display size | 4.01 | 3.0 | pass |
| **`gold` as text on cream** | **2.27** | 4.5 | **FAIL** |
| **`gold` as non-text on cream** | **2.27** | 3.0 | **FAIL** |
| **`muted` on a `wine`/5% tint** | **2.96** | 4.5 | **FAIL** |
| `roseDeep` as text on cream | 5.65 | 4.5 | pass |
| white on `roseDeep` | 6.02 | 4.5 | pass |
| white on `wine` | 16.54 | 4.5 | pass |
| `cream` on `wine` | 15.51 | 4.5 | pass |
| `gold` on `wine` | 6.84 | 4.5 | pass |

### Corrections — lightness only, hue and saturation untouched

The same method D-007 and D-038 used. Each is the *smallest* move that clears the gate:

| Token | Brief's value | Corrected | Why |
| :--- | :--- | :--- | :--- |
| `muted` | `#8B888F` | **`#706D74`** | 4.5:1 on cream, white **and** `roseTint` simultaneously |
| `rose` | `#D9486B` | **keep** — but **non-text only** | 3.87 on cream clears the 3:1 non-text bar. Chart strokes, active indicators, borders. |
| `roseDeep` | `#B3324F` | **keep** | Already passes as text (5.65) and as a button fill (6.02). **This is the interactive token**, exactly as `taupeDeep` is today. |
| `gold` | `#C9A227` | **keep, but only on `wine`** | 6.84 on wine; 2.27 on cream fails even the non-text bar. Gold on a light surface is not usable in this palette at any size. |
| hero accent word | `rose` on `wine` | **allowed at display size only** | 4.01 clears 3:1 for large text. If the accent word ever appears at body size, use **`#DD5979`**. |

**Consequence for the design language:** `rose` is the *colour of the brand*, `roseDeep` is
the *colour of interaction*. Buttons, links and active labels take `roseDeep`. This mirrors
the taupe/taupeDeep split the codebase already understands, so the change is structural
continuity rather than a new concept.

**The gold rule is a real constraint on the brief.** §4 says "gold provides tiny
jewellery-related details" — those details can live on wine surfaces (footer, hero, trust
band) but *not* on cream or white. Any gold hairline on a light card would fail. This is
consistent with the brief's own instruction to avoid decorative gold borders.

---

## F. Conflicts the owner must resolve before implementation

**F-1 — MASTER-SPEC §3 defines the palette and outranks this brief.**
`specs/00-MASTER-SPEC.md:3` states: *"If a phase file contradicts this document, this
document wins."* Its §3 hardcodes the cream/taupe tokens and an "Airbnb / Headout" reference.
The redesign brief overrides both. **MASTER-SPEC §3 must be formally amended and the change
recorded in `DECISIONS.md`**, or every future phase will contradict the shipped UI. This is a
one-paragraph edit, but skipping it leaves two contradicting sources of truth.

**F-2 — The reference image was never attached.**
Brief §1 names it "the PRIMARY visual reference" and §36 the "visual north star". It did not
arrive in this session. Everything derivable from the written brief — palette, typography,
structure, motion, spacing — is actionable now. What is *not* derivable is the specific
editorial composition: image treatment, crop ratios, headline scale relative to imagery,
card proportion. **Phases 03–07 of the TODO can proceed without it. Phase 11 (homepage hero)
should not be finalised without it.**

**F-3 — Admin desktop layout.** Brief §18 wants a sidebar; `admin-nav.tsx` argues
deliberately for a bottom nav on all viewports. Recommendation: **honour the brief** — add a
desktop sidebar at `md:` and keep the bottom nav below it. The stated reason (one-handed
phone use in a shop) is a *mobile* argument and is fully preserved by a responsive split.

**F-4 — Tests encode the current palette.** `contrast.test.ts` asserts literal hex
(`expect(COLORS.muted).toBe('#6E6560')`), `lib/design/tokens.ts` mirrors `globals.css`, and a
test parses the stylesheet to prove they agree. `e2e/design-system.spec.ts` and
`e2e/a11y.spec.ts` measure rendered colour. A palette swap is a **coordinated change across
those files and their assertions** — expected and correct, not breakage, but it must be done
as one deliberate step (TODO 03), never incrementally.

---

## G. UI_REDESIGN_DEBT

Recorded, not fixed, per brief §2.

**UI_REDESIGN_DEBT-001 — Homepage hero MediaSlot has no video support.**
*Problem:* brief §9 specifies a `HeroMedia` component with poster→video progressive
enhancement. `MediaSlot` (`app/(app)/page.tsx:78`) stores `imageUrl` + `blurDataUrl` only —
there is no video column, so an admin cannot supply the video the component would play.
*Affected:* `prisma/schema.prisma` (`MediaSlot`), `app/admin/media/`, `lib/media/slots.ts`.
*Severity:* MEDIUM — blocks §9's full behaviour, not the hero itself.
*Recommended fix:* ship `HeroMedia` accepting an optional `videoSrc`, initially `undefined`.
Adding a nullable `videoUrl` column is a schema change and is **out of UI-redesign scope** —
raise it as its own phase.

**UI_REDESIGN_DEBT-002 — `next` redirect accepts the backslash form.**
*Problem:* `/\evil.com` passes the `startsWith('//')` guard; some browsers normalise it to
protocol-relative.
*Affected:* `app/(auth)/login/login-form.tsx:47`.
*Severity:* LOW.
*Recommended fix:* extract one shared `safeNext(path)` helper — reject unless
`/^\/(?![/\\])/` — and use it in login, signup and forgot-password. Needed anyway for TODO 10.

**UI_REDESIGN_DEBT-004 — the brief's admin "Orders" destination has no route.**
*Problem:* Stage 2 §6 lists Orders among the admin navigation destinations. `/admin/orders`
does not exist. A customer `Order` row is written by the bill builder
(`lib/bills/create.ts`), and the admin's view of orders is `/admin/bills` — so the concept is
covered, but under a different name.
*Affected:* `lib/navigation.ts`, `app/admin/`.
*Severity:* LOW — nothing is unreachable; the label is the only gap.
*Recommended fix:* none required. `ADMIN_PRIMARY`'s Bills entry is described as "Bills and
orders", and `lib/navigation.test.ts` asserts that `/admin/orders` is never added without a
route behind it. If a dedicated order list is ever wanted it is a new page, not a rename.

**UI_REDESIGN_DEBT-006 — `/claim/[token]` was not restyled with the auth screens.**
*Problem:* the order-claim flow is auth-adjacent — it verifies a phone by OTP — but lives in
the `(app)` group with the full storefront shell rather than in `(auth)`, and it renders its
own `Card`-based UI. Stage 3 restyled the three `(auth)` routes and left it alone.
*Affected:* `app/(app)/claim/[token]/page.tsx`, `claim-card.tsx`.
*Severity:* LOW — it works, it is on the Stage 1 tokens, and it is reached from a WhatsApp
link rather than from the auth screens, so nobody sees the two treatments side by side.
*Recommended fix:* restyle it with the order UI in Stage 4, not with auth. Moving it into
`(auth)` was considered and rejected: it is a storefront destination and the shell it has is
the right one.

**UI_REDESIGN_DEBT-005 — client-side errors are not reported.**
*Problem:* `app/error.tsx` renders a recovery UI but captures nothing. A SERVER render error
is already reported by `onRequestError` in `instrumentation.ts` before the boundary paints, so
that half is covered; a purely client-side throw is not, because this project has no browser
Sentry init (there is no `instrumentation-client.ts`). A `captureException` call was written
and then removed: it would have compiled, type-checked and silently done nothing.
*Affected:* `app/error.tsx`, `instrumentation.ts`, `lib/monitoring/sentry.ts`.
*Severity:* MEDIUM — the application has run nine phases this way, so this is a pre-existing
gap Stage 2 documented rather than one it introduced.
*Recommended fix:* add a client Sentry init. It is a monitoring decision with a bundle-size
cost and a DSN to scope, not a UI-redesign change — its own task.

**UI_REDESIGN_DEBT-003 — `Button` cannot render an anchor.**
*Problem:* forces hand-copied button styling at two call sites (D-4); any restyle must be
applied in three places.
*Affected:* `components/ui/button.tsx`, `app/(app)/page.tsx:143`, `components/shell/footer.tsx:66`.
*Severity:* LOW, rising to MEDIUM once the wine hero CTA becomes a third clone.
*Recommended fix:* add an `asChild` prop. Do it in TODO 05, before the hero is built.

---

## H. What must not be touched

Confirmed present and deliberately out of scope: integer-paise/`BigInt` money handling,
`lib/pricing.ts`, GST and `lib/bills/totals.ts`, the Prisma schema, every `/api/*` contract,
Argon2id + session/OTP mechanics, `requireAdmin()` / `requireAdminPage()`, the
`proxy.ts` 404-not-403 admin rule, rate snapshotting, order claiming, WhatsApp deep-link
encoding, `backend/celery_app/`, and Redis configuration.

Two structural details that look like defects and are not — **do not "clean up" either**:

1. `--sticky-bar-height` is published from a **runtime measurement**; it was hardcoded twice
   and was wrong twice (`dbc97d4`).
2. The homepage `h1` is `sr-only` for the fold-position reason in C-10, not by oversight.
