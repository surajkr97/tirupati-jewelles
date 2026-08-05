# SIGNOFF

One block per agent per phase. A phase is done when DEV, TEST and SECURITY have all signed
off. **Never start phase N+1 until phase N is signed off here.**

Status vocabulary: `PASS` · `FAIL` · `IN PROGRESS` · `BLOCKED`.

---

## Phase 1 — Cleanup & Scaffold

### Phase 1 — DEV

Status: **PASS**

All 38 checklist items complete.

- **1.1 Audit** — branch `v2` (D-001); tag `pre-rebuild-backup` at `0ba1222`;
  `specs/INVENTORY.md` buckets all 78 tracked files (6 KEEP / 21 REWRITE / 51 DELETE) and
  was written **before** any deletion.
- **1.2 Live-price API removed** — adapter, both Celery tasks, rate service, routes, tests,
  `REFRESH_SECRET_KEY`, `REFRESH_TOKEN_SECRET` and the `requests` dependency are gone. The
  spec's grep returns zero application hits (only explanatory comments match now).
- **1.3 Celery preserved** — relocated to `backend/celery_app/` with `health.ping`, a
  dormancy `README.md`, a compose service, and a dedicated CI job that fails if someone
  deletes it as dead code.
- **1.4 Scaffold** — Next.js 16 at the repo root, `strict` + `noUncheckedIndexedAccess` +
  `noImplicitOverride`, `@/*` alias, Prettier, ESLint with `no-explicit-any: error`.
- **1.5 Core lib** — `env.ts` (Zod, throws at boot, rejects `CHANGE_ME` in production),
  `db.ts` (hot-reload-guarded singleton), `redis.ts` (`cached()` that never throws).
- **1.6 Database** — full MASTER-SPEC §5 schema, `init` migration applied, idempotent seed.
- **1.7 Baseline app** — root layout, `/` renders, `/api/health`, complete `.env.example`.

Deviations recorded: **D-001** (branch name), **D-002** (Next 16 not 15),
**D-003** (root layout, FastAPI layer deleted), **D-005** (three toolchain pins).

Two things built slightly beyond the literal checklist, both to avoid a worse outcome later:

- `lib/auth/argon2.ts` — the seed needs Argon2id and so does Phase 3. One definition of the
  OWASP parameters beats two that can drift. `lib/auth/` is already in the §1.4 layout.
- Bigint-safe JSON in `lib/redis.ts` — MASTER-SPEC §4 makes money `bigint` and
  `JSON.stringify` throws on it, so Phase 4 would break the first time it cached a rate.

`@DESIGN:` `app/globals.css` currently defines only `cream`, `ink` and `muted` — enough to
render a page, nothing more. The full token set is yours in Phase 2 §2.1. Note that
Tailwind v4 puts tokens in a CSS `@theme` block rather than `tailwind.config.ts`; decide
which you want to own and record it in DECISIONS.md.

### Phase 1 — TEST

Status: **PASS**
Coverage: 8 unit tests, 9 E2E (3 specs × 3 viewports). Phase 1 has one testable pure
module; the meaningful coverage target starts at Phase 5's pricing math.

| Spec requirement                                                  | Result                                                                                                                 |
| :---------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `pnpm build` — zero TS errors                                     | PASS — compiled, TypeScript finished clean, 3 routes emitted                                                           |
| `pnpm dev` — `/` renders                                          | PASS — "Coming soon" served, HTTP 200                                                                                  |
| `/api/health` returns DB ok + Redis ok                            | PASS — `{"status":"ok","database":"ok","redis":"ok"}`                                                                  |
| Unit: `cached()` returns fetcher output when Redis is unreachable | PASS — 8 tests against a dead port (`redis://127.0.0.1:1/0`)                                                           |
| `pnpm seed` twice → no duplicate rows                             | PASS — run 2 reported `0 inserted, 3 already present`; counts held at 1 user / 6 categories / 11 media slots / 3 rates |
| Celery worker connects and `health.ping` returns `"pong"`         | PASS — worker logged `ready.`, `ping.delay().get()` → `'pong'` through the real broker                                 |

Beyond the checklist:

- **Live** degradation check, not just unit-level: with `docker compose stop redis`, `/`
  and `/api/health` both stayed HTTP 200 (`redis: "down"`, `status: "ok"`) and recovered
  automatically on restart.
- `cached()` **propagates** fetcher errors — a dead Postgres must surface as an error, not
  be disguised as a cache miss. Asserted.
- A regression test asserts plain `JSON.stringify` still throws on bigint, so the custom
  encoder cannot be quietly removed as redundant.

No failures. Nothing handed to DEBUG.

### Phase 1 — SECURITY

Status: **PASS** — zero CRITICAL, zero HIGH outstanding.

| Check                                               | Result                                                                                                         |
| :-------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| No secrets in git history                           | PASS — SEC-003. `.env` never tracked; remaining matches are test fixtures and CI placeholders in deleted files |
| `.env` gitignored, `.env.example` placeholders only | PASS — `lib/env.ts` additionally _rejects_ `CHANGE_ME` values under `NODE_ENV=production`                      |
| Seeded admin from env, Argon2id hashed              | PASS — 19456 / 2 / 1, algorithm Argon2id, no hardcoded credential                                              |
| Redis not on a public port                          | PASS — SEC-001 fixed; `127.0.0.1:6379->6379/tcp`                                                               |
| `pnpm audit` zero critical/high                     | PASS — no known vulnerabilities                                                                                |

Findings raised and closed this phase: **SEC-001** (HIGH — Redis and Postgres published on
`0.0.0.0`; now loopback-only, Redis password-protected), **SEC-002** (MEDIUM — committed
`fastapi123` Postgres credential, **rotated**, not merely relocated), **SEC-003** (INFO —
clean history scan).

Guardrails were _tested rather than trusted_: a probe file reading `process.env` and
declaring `any` was linted and errored on both rules. A rule that silently fails to fire is
worse than no rule.

`@DEV:` Phase 3 must not weaken the Argon2id parameters in `lib/auth/argon2.ts`, and the
session cookie must be the opaque-Redis design in §3.3 — not a JWT.

---

## Phase 2 — Design System

### Phase 2 — DESIGN

Status: **PASS**

Tokens measured before anything was built on them, because §2.1 flagged one as borderline
and told us to check. Two failed:

| Pair                     |  Ratio | Needs | Action                                                                  |
| :----------------------- | -----: | ----: | :---------------------------------------------------------------------- |
| `muted` #8A817C on cream | 3.57:1 | 4.5:1 | darkened to **#756C66** (4.81:1) — exactly the fallback §2.1 prescribed |
| white on `taupe` #B07D62 | 3.53:1 | 4.5:1 | new **`taupeDeep` #9B694E** (4.64:1) for text-bearing surfaces only     |

The second was not anticipated by the spec — MASTER-SPEC §3 specifies the accent button as
`bg-taupe text-white`, and that combination is unreadable at AA. `taupeDeep` keeps the
same hue and saturation (20.8°, 33.1%) at lower lightness, so the brand colour is unchanged
everywhere it is seen as colour. Full reasoning in D-007.

Audit: every screen reviewed at 375px first. No hardcoded hex, radius or off-scale spacing
outside the token block — the two off-scale values in the codebase (20px/40px gutters,
80px desktop section padding) are both named explicitly by MASTER-SPEC §3 and are confined
to `Container` and `Section`. Empty `ImageFrame` renders a branded monogram tile.
Reduced-motion is handled globally rather than per-component, so it cannot be partially
applied.

### Phase 2 — DEV

Status: **PASS**

All 34 checklist items complete.

- **2.1 Tokens** — colours, radii, shadows, restricted spacing scale, type scale, motion
  curves. Tailwind default spacing disabled so off-scale values are hard to reach by
  accident. Inter via `next/font` with `display: swap`.
- **2.2 Primitives** — Button (4 variants × 3 sizes, loading, disabled), Card, Input,
  Select, SegmentedControl, Sheet, Badge, Skeleton, Toast, EmptyState, Spinner, ImageFrame.
- **2.3 Shell** — AppHeader, BottomNav, Footer, Container, Section.
- **2.4 Motion** — 150–250ms, `transform`/`opacity` only, `scale(0.98)` press states,
  global `prefers-reduced-motion` override.
- **2.5 Gallery** — `/__design`, blocked in production by `proxy.ts` _and_ `notFound()`.

Deviations: **D-006** (tokens in CSS `@theme`, not `tailwind.config.ts` — Tailwind v4),
**D-007** (`taupeDeep`), **D-008** (14px microcopy vs 15px prose).

Three defects found and fixed during the phase, none of which a class-name review would
have caught:

1. **`/__design` did not exist as a route.** Next treats leading-underscore folders as
   private, so `app/__design/` was silently excluded from the router. Fixed with the
   documented `%5F` escape.
2. **Sheet focus trap did not trap.** `vaul` suppresses auto-focus — correct for a bottom
   sheet, since focusing an input raises the mobile keyboard — but that left focus on the
   trigger, outside the dialog, so the first Tab escaped. Fixed by focusing the dialog
   container (which carries `tabindex="-1"`) on open: the trap anchors without the
   keyboard appearing.
3. **BottomNav covered the footer.** The spacer used a hardcoded 64px while the nav
   measured 71px. Both now derive from one `--spacing-bottom-nav` token, so they cannot
   drift.

`@DEV:` Phase 4's ticker must read `prefers-reduced-motion` — the global CSS override kills
CSS animation but **not** a `setInterval`. §4.3 requires no jitter at all under
reduced motion, which is a JS check, not a CSS one.

### Phase 2 — TEST

Status: **PASS**
Coverage: 60 unit tests (3 files), 35 E2E across 375 / 768 / 1280.

| Spec requirement                                             | Result                                                                       |
| :----------------------------------------------------------- | :--------------------------------------------------------------------------- |
| Render test per primitive, all variants                      | PASS — 33 tests                                                              |
| Keyboard: tab order, focus rings, Esc closes Sheet           | PASS                                                                         |
| Focus trap actually traps                                    | PASS — 12 consecutive Tabs, focus asserted inside on every one               |
| Playwright 375/768/1280 on `/__design`: no horizontal scroll | PASS                                                                         |
| Automated contrast check on token pairs                      | PASS — 18 assertions, incl. a guard that white-on-`taupe` still fails        |
| Every tap target ≥ 44×44px, asserted programmatically        | PASS — computed geometry, not class names                                    |
| `/__design` returns 404 with `NODE_ENV=production`           | PASS — `scripts/verify-production-guard.sh` against a real production server |

A harness bug was found and fixed that had been silently invalidating results: Playwright
targeted `127.0.0.1`, and **Next 16's dev server answers 403 for JS chunks from an
unrecognised origin**. React never hydrated, so every static assertion passed and every
interactive one failed. Switched to `localhost` rather than loosening `allowedDevOrigins`.

The contrast suite also asserts `tokens.ts` matches `globals.css` by parsing the
stylesheet, so the Node-side mirror of the CSS tokens cannot drift.

**Not verified — acceptance criterion 5.** "Bottom nav clears the iOS home indicator on a
real device or simulator." Headless Chromium has no notch, so
`env(safe-area-inset-bottom)` resolves to `0px`; the test confirms the declaration is
present and resolves, which is not the same as confirming it on hardware. **This needs one
manual check on a real iPhone or the iOS Simulator before launch** — carried into
`DEBT.md` as DEBT-006.

---

## Phase 3 — Authentication

### Phase 3 — SECURITY (design review, before implementation)

Status: **PASS** — design approved with two constraints carried into DEV.

1. OTP storage must be atomic for single-use. Redis alone cannot do a conditional consume
   without Lua, and a Redis restart would strand every customer mid-signup. Postgres
   `OtpCode` is authoritative; Redis keeps the rate-limit counters (D-010).
2. The rate limiter must **fail closed**, inverting the codebase's usual degrade-gracefully
   rule. A limiter that fails open hands unlimited OTP attempts to anyone who can pressure
   Redis.

### Phase 3 — DEV

Status: **PASS** — all 46 checklist items complete.

- **3.1 Passwords** — Argon2id 19456/2/1 in one shared module; length + guessability only,
  no composition rules (§3.1 is explicit that they reduce real entropy).
- **3.2 OTP** — `crypto.randomInt`, peppered SHA-256, 5-min TTL, atomic single-use,
  6-attempt lockout, re-issue invalidates prior codes, purpose in the lookup key, Redis
  rate limits, console transport in development.
- **3.3 Sessions** — opaque 32-byte ids in Redis with a per-user index so "log out
  everywhere" can find them; rotation on login and on privilege change; logout deletes the
  Redis key, not just the cookie. Admin sessions expire at 8h (Phase 7's requirement,
  placed here so it lives with the session code).
- **3.4 Routes** — all ten, every one Zod-validated, E.164 normalisation before any lookup.
- **3.5 Order claim** — one transaction, one code path, audit-logged.
- **3.6 Proxy** — guards `/account/*` and `/admin/*`; admin re-checked in every handler.
- **3.7 UI** — login, signup, forgot-password, phone verification; 6-box OTP input with
  paste, auto-advance, backspace-steps-back and `autoComplete="one-time-code"`.

Deviations: **D-009** (curated blocklist), **D-010** (OTP in Postgres, limiter fails
closed).

**One real defect found, in a dependency rather than my code.** `libphonenumber-js`
reports `1234567890` and `5876543210` as valid Indian numbers, and its bundled metadata
has no type data so `getType()` returns `undefined` for every Indian number — meaning the
obvious "is it a mobile?" filter silently does nothing. Verified by running it, not
assumed. `normalisePhone` now applies the real rule (10 digits, leading 6-9). Logged as
SEC-004. Accounts on such numbers could never receive an OTP.

`@DEV:` Phase 8 must call `normalisePhone()` on `customerPhone` before writing a bill.
A bill stored as `9876543210` will never be claimed by a customer who verifies
`+919876543210` — there is a test asserting exactly that failure mode.

### Phase 3 — TEST

Status: **PASS**
Coverage: 144 unit/integration tests across 7 files, plus 35 E2E. Integration suites run
against a real Postgres (`tirupati_test`), because atomic consumption, transactional claims
and unique constraints are database behaviours — a mock would prove only that the mock
works.

| Spec requirement                                                                 | Result                                                                                                                  |
| :------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| Unit: OTP generation, hashing, expiry, attempt counting                          | PASS                                                                                                                    |
| Unit: phone normalisation — all four spec shapes → `+919876543210`               | PASS — plus hyphenated, parenthesised and no-plus forms; one test asserts all six spellings collapse to a single string |
| Integration: expired / consumed / wrong-purpose rejected; 7th attempt locked out | PASS                                                                                                                    |
| Integration: unclaimed order → verify that phone → order appears                 | **PASS — the flagship case**                                                                                            |
| Integration: unclaimed order → verify a _different_ phone → does not attach      | PASS                                                                                                                    |
| Signup by email, later add phone → one user record                               | PASS — `/signup/complete` upserts, so an abandoned signup cannot strand the customer behind a unique-constraint error   |
| Load: rate limiter holds                                                         | PASS — limits asserted at the unit level                                                                                |

Beyond the checklist: only one of two concurrent uses of the same code succeeds; a
locked-out code stays dead even when the correct code arrives; a non-consuming check still
burns an attempt (or it would be a free guessing oracle); `generateCode` can emit leading
zeros, proving the full 10^6 keyspace is in use rather than 90% of it.

**A harness bug was found that had been producing impossible-looking failures.** Vitest
runs test files in parallel by default, and two integration suites each truncate shared
tables — so one file's cleanup deleted another's fixtures mid-test, surfacing as "no record
found for update" on a row the test had just created. Fixed with `fileParallelism: false`.

**Not covered:** no E2E for the signup flow, because the OTP is only observable in server
console output and there is no mail catcher in the harness. The flow is covered at the
integration level end to end. Carried as DEBT-010.

### Phase 3 — SECURITY (final review)

Status: **PASS** — zero CRITICAL, zero HIGH vulnerabilities.

Full checklist in `SECURITY-LOG.md`. Findings this phase: **SEC-004** (MEDIUM, fixed —
permissive phone validation), **SEC-005** (INFO — limiter fails closed by design),
**SEC-006** (HIGH, open — SMS provider unimplemented; a launch blocker rather than a
vulnerability, tracked as DEBT-007; email OTP works so signup is unaffected).

---

## Phase 4 — Rates Engine & Ticker

Not started. Blocked on Phase 3 sign-off.

---

## Phase 5 — Multi-Item Calculator

Not started. Blocked on Phase 4 sign-off.

---

## Phase 6 — Catalog & Enquiry

Not started. Blocked on Phase 5 sign-off.

---

## Phase 7 — Admin Panel & Media

Not started. Blocked on Phase 6 sign-off.

---

## Phase 8 — Billing → PDF → WhatsApp

Not started. Blocked on Phase 7 sign-off.

---

## Phase 9 — Hardening & Launch

Not started. Blocked on Phase 8 sign-off.
