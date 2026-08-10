# DECISIONS

Deviations from the build specification, with reasoning. Per AGENTS.md, any departure from
`00-MASTER-SPEC.md` or a phase file is recorded here rather than made silently.

---

## D-001 — Branch is `v2`, not `rebuild/clean-slate`

**Spec:** Phase 1 §1.1 — `git checkout -b rebuild/clean-slate`
**Actual:** work happens on `v2`.

**Reasoning:** the repo owner explicitly asked for a branch named `v2` before the spec was
handed over. The branch _name_ carries no engineering weight; the safety net the checklist
actually depends on is the tag, and that was created exactly as specified:

```
git tag pre-rebuild-backup   # → commit 0ba1222, the last master commit before the rebuild
```

`git checkout pre-rebuild-backup` restores the pre-rebuild tree regardless of branch name.

---

## D-002 — Next.js 16, not Next.js 15

**Spec:** MASTER-SPEC §2 — "Frontend: Next.js 15, App Router, TypeScript strict"
**Actual:** Next.js 16.

**Reasoning:** the repo already had Next.js 16.2.11 installed before the rebuild, and 16 is
the current stable release. Scaffolding a new application on 15 would mean shipping a
deliberate regression and paying the 15→16 migration cost later anyway. The spec's stack
table names 15 incidentally (it fixes the _framework_, not a patch line) — unlike, say,
"money is integer paise", which is a load-bearing constraint and is being followed exactly.

**Consequences that later phases must respect** — Next.js 16 has breaking changes that
contradict the literal text of several phase files:

| Spec says                      | Next.js 16 requires                                                      | Affected                                 |
| :----------------------------- | :----------------------------------------------------------------------- | :--------------------------------------- |
| `middleware.ts`                | `proxy.ts` (same position in the request path, new filename + signature) | Phase 3 §3.6, Phase 7 §7.1, Phase 9 §9.1 |
| `next.config.js`               | `next.config.ts`                                                         | Phase 9 §9.1 headers                     |
| sync `cookies()` / `headers()` | `await cookies()`, `await headers()`                                     | Phase 3 sessions                         |
| sync `searchParams`            | `await searchParams`                                                     | Phase 6 filters                          |

Where a phase file says "middleware", read "proxy". The security property the spec is
actually asserting — _the edge check is not a boundary; re-check the role inside the
handler_ — is unchanged and still enforced.

**Verification:** `frontend/AGENTS.md` in the pre-rebuild tree carried a standing warning
that this repo's Next.js differs from training data and that
`node_modules/next/dist/docs/` is the source of truth. That warning is preserved at
`AGENTS.md` in the new root.

---

## D-003 — Next app at the repo root; `frontend/` and `server/` dissolved

**Spec:** Phase 1 §1.4 gives a root-level layout (`app/`, `components/`, `lib/`,
`prisma/`, `specs/`, `e2e/`) alongside `backend/celery_app/`.
**Pre-rebuild:** a two-tree repo — `frontend/` (Next.js) and `server/` (FastAPI).

**Reasoning:** following the spec's layout literally. The consequence is significant and
worth stating plainly: **the FastAPI application layer is deleted, not ported.** Auth,
rates, routes, models, schemas and services move to the Next.js side in Phases 3–8, per the
spec's stack table (Postgres + Prisma, custom Argon2id + session cookie auth). What survives
from `server/` is only the dormant Celery + Redis infrastructure, relocated to
`backend/celery_app/` as Phase 1 §1.3 requires.

Full file-by-file accounting in `specs/INVENTORY.md`.

---

## D-005 — Toolchain pinned below "latest" in three places, each for a concrete blocker

Everything else is on the current release. These three are not:

| Package                     | Latest | Pinned     | Blocker                                                                                                                                                                                                                                       |
| :-------------------------- | :----- | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript`                | 7.0.2  | **5.9.3**  | `@typescript-eslint` 8.66 (newest stable) declares `typescript: >=4.8.4 <6.1.0`. No stable typescript-eslint supports TS 7. Phase 1 §1.4 _requires_ `@typescript-eslint/no-explicit-any: error`, so TS 7 would mean dropping a mandated rule. |
| `eslint`                    | 10.8.0 | **9.39.5** | `eslint-plugin-react` 7.37.5, pulled in transitively by `eslint-config-next`, crashes on ESLint 10 (`contextOrFilename.getFilename is not a function` — ESLint 10 changed the rule-context API). Verified by running it, not assumed.         |
| `prisma` / `@prisma/client` | 7.9.1  | **6.19.3** | Prisma 7 declares `engines.node: ^20.19 \|\| ^22.12 \|\| >=24.0`. This machine runs **Node v23.11.0**, which satisfies none of them. See DEBT-005.                                                                                            |

Two points worth carrying into later phases:

1. **The lint and type ecosystem lags the compiler.** TypeScript and ESLint majors ship
   months before plugins follow. Pinning to whatever `npm view … version` returns is not
   the same as pinning to what works together.
2. **None of these is permanent.** Each unblocks on its own schedule — typescript-eslint
   shipping TS 7 support, `eslint-plugin-react` shipping ESLint 10 support, and the Node
   upgrade in DEBT-005. Re-check at Phase 9 §9.1.

`eslint-config-next` 16 exports a **native flat-config array**, so `eslint.config.mjs` uses
it directly. Routing it through `FlatCompat` crashes ESLint while serialising the react
plugin (circular structure); the `@eslint/eslintrc` shim was added, found to break, and
removed.

---

## D-004 — GST on making charges is a config value, flagged for the client's CA

**Spec:** MASTER-SPEC §4 and Phase 5 §5.2 apply 3% GST to metal value **plus** making
charges, and instruct that this be flagged rather than presented as tax advice.

**Status:** implemented as specified, with `gstPct` admin-configurable and the making-charge
treatment isolated to a single point in `lib/pricing.ts`. Logged in `DEBT.md` as requiring
the client's CA to confirm before launch. Nothing in this repo constitutes tax advice.

---

## D-006 — Design tokens live in a CSS `@theme` block, not `tailwind.config.ts`

**Spec:** MASTER-SPEC §3 and Phase 2 §2.1 put colours, radii and the spacing scale in
`tailwind.config.ts`. AGENTS.md gives DESIGN ownership of that file.
**Actual:** they live in an `@theme` block in `app/globals.css`.

**Reasoning:** Tailwind v4 — which the pre-rebuild repo already used — replaced the
JavaScript config with CSS-first configuration. A `tailwind.config.ts` is still _loadable_
via the `@config` directive, but it is the legacy path: v4 generates utilities directly
from the CSS custom properties in `@theme`, and mixing the two means two places to look
for one token.

The spec's intent — one authoritative token list that DESIGN owns and nothing else
hardcodes — is fully preserved. Only the file changed.

**DESIGN now owns:** `app/globals.css` (the `@theme` block), `components/ui/`, and
`lib/design/tokens.ts`.

That last file is a deliberate, tested duplication: Vitest runs in Node and cannot read CSS
custom properties, so the contrast assertions need the values in TypeScript.
`lib/design/contrast.test.ts` parses `globals.css` and fails if the two disagree, so the
mirror cannot silently drift.

---

## D-007 — `taupeDeep` added: white on `taupe` fails WCAG AA

**Spec:** MASTER-SPEC §3 — "Accent = `bg-taupe text-white`", with `taupe` = `#B07D62`.
**Actual:** the accent _button_ uses a new token `taupeDeep` = `#9B694E`. `taupe` itself
is unchanged.

**Reasoning:** measured, not assumed. §2.1 told us to verify `muted` on cream because it
was "borderline"; measuring the whole palette while there turned up a second failure the
spec did not anticipate:

| Pair                         |      Ratio |     Needs | Verdict                                                             |
| :--------------------------- | ---------: | --------: | :------------------------------------------------------------------ |
| `muted` #8A817C on cream     |     3.57:1 |     4.5:1 | FAIL → darkened to **#756C66** (4.81:1), exactly as §2.1 prescribed |
| **white on `taupe` #B07D62** | **3.53:1** | **4.5:1** | **FAIL → new `taupeDeep` #9B694E (4.64:1)**                         |

Button labels are 16px semibold. WCAG's "large text" allowance (3:1) starts at 18.66px
bold or 24px regular, so a button label does not qualify and needs the full 4.5:1.

`#9B694E` is the _same hue and saturation_ as `#B07D62` (20.8°, 33.1%) with lightness
dropped from 53.7% to 46%. The brand colour is unchanged everywhere it is seen as colour —
active pills, badges, tints, icons, the accent border. Only text-bearing surfaces switch.

Guarded by `lib/design/contrast.test.ts`, which asserts white-on-`taupe` **still fails** —
so if someone "simplifies" the accent button back to `bg-taupe`, a test fails and explains
why rather than the regression shipping silently.

---

## D-008 — 14px is microcopy; 15px is the floor for prose

**Spec:** MASTER-SPEC §3 states both "Small 14/20" and "Never below 15px for body copy."

Taken literally these contradict each other, so they were read as governing different
things — the only interpretation under which both hold:

- **14px (`text-small`)** — field labels, form hints, validation messages, badges,
  captions, table metadata, nav labels. UI microcopy.
- **15px and above** — running prose: paragraphs, descriptions, article text.

`e2e/design-system.spec.ts` asserts both halves: a hard 14px floor for _any_ text anywhere,
and a 15px floor for prose (a `<p>` of 40+ characters that is not a hint or an alert). The
first test is what stops the interpretation being used as an excuse to shrink things.

---

## D-009 — Common-password blocklist is curated, not the full top-10k

**Spec:** §3.1 — "Check against a top-10k common-password list."
**Actual:** ~250 entries in `lib/auth/password-policy.ts`, plus pattern rules.

**Reasoning and honest limitation.** The list is deliberately weighted rather than long:
it carries the global top ~150 (which cover the overwhelming majority of credential-
stuffing attempts), plus two groups a generic English top-10k largely **misses** —
India-specific choices (`india123`, `krishna`, `jaimatadi`, `sachin123`, city names) and
shop-specific ones (`tirupati`, `goldsilver`, `sonachandi`). For this user base that set
plausibly blocks more real guesses than a generic 10k would.

It is still not 10,000 entries, and a determined chooser can land on something common that
is not listed. Three pattern rules cover what no list can enumerate — digits-only (dates
of birth, phone numbers), a single repeated character, and keyboard runs — and a
trailing-digit strip means `krishna2024` is caught by the `krishna` entry.

**Tracked as DEBT-008** to load a real 10k list from a data file before launch.

---

## D-010 — OTP source of truth is Postgres; Redis holds only rate-limit counters

**Spec:** MASTER-SPEC §7 lists a Redis key `otp:{identifier}:{purpose}` holding "hashed OTP

- attempt count". §3.2 requires `attempts`, `consumedAt`, single-use and a 6-attempt
  lockout, and the Prisma schema has an `OtpCode` model with exactly those columns.

**Actual:** `OtpCode` in Postgres is authoritative. Redis holds `rl:*` counters only.

**Reasoning:**

1. **Single-use needs atomicity.** Consumption is
   `UPDATE ... WHERE id = ? AND consumedAt IS NULL`, which makes exactly one of two
   concurrent submissions of the same correct code win. Doing that in Redis needs a Lua
   script; Postgres gives it directly, and there is a test asserting it.
2. **MASTER-SPEC §7 also says a Redis outage must never break the site.** A Redis-only OTP
   store discards every pending code the moment Redis restarts — every customer
   mid-signup is stranded.
3. The schema already models it. Two sources of truth for one code is worse than either.

Rate limiting stays in Redis exactly as specified, because a counter is what Redis is for.

**One deliberate inversion of the usual rule.** `lib/auth/rate-limit.ts` **fails closed**
on a Redis fault, unlike `cached()`, which always degrades gracefully. If the limiter
cannot count, failing open hands an attacker unlimited OTP attempts by pressuring Redis.
Only auth and billing routes are affected; browsing, rates and the calculator stay up.

---

## D-011 — Email-only OTP via Resend; SMS deferred; the order claim stays locked

**Spec:** §3.2 — "Email via SMTP. SMS via MSG91/Twilio behind an interface." MASTER-SPEC §5
makes verified phone possession the key to the order claim.
**Actual:** every OTP goes to email, delivered by Resend. SMS is not enabled. Adding a
phone number is authorised by an email code. **The order claim is unreachable.**

### Resend instead of SMTP

Render — the deployment target — blocks outbound SMTP ports (25/465/587) on most plans.
A nodemailer transport therefore works perfectly in development and silently times out in
production, which is the worst failure shape available: signup appears to work and no
customer ever receives a code. Resend is an HTTPS API and is unaffected. `nodemailer` was
removed.

In production a missing `RESEND_API_KEY` is a hard failure at first use, never a silent
downgrade to the console logger — printing OTPs to production stdout would hand every code
to anyone with log access.

### The part that matters: what an email code can and cannot prove

|                                               | Proves                     | Does not prove                  |
| :-------------------------------------------- | :------------------------- | :------------------------------ |
| Code sent to the account's verified **email** | control of the **account** | control of the **phone number** |
| Code sent **to the number** (SMS / WhatsApp)  | control of the **number**  | —                               |

MASTER-SPEC §5 is unambiguous: _"The claim runs only after successful OTP verification of
that exact number. Never on an unverified phone field. This is the difference between a
feature and an account-takeover vector."_

If adding a phone via an email code also claimed orders, **anyone could type a stranger's
mobile number and read their entire purchase history.** So the flows are split:

- `ADD_PHONE` — email-delivered. Sets `User.phone` so the number works as a login
  identifier. Leaves `phoneVerified` **false**. Does **not** claim.
- `CLAIM_ORDER` — requires a code delivered _to the number_. Currently unreachable.

`claimOrdersForVerifiedPhone` is kept complete and fully tested, with no caller. Whichever
possession proof arrives first simply calls it.

### What this costs, stated plainly

**The Phase 8 headline feature does not work yet.** A customer cannot see a bill that was
sent to their phone, because nothing can prove the number is theirs. Two ways to restore
it, in preference order:

1. **The Phase 8 WhatsApp bill link.** The bill is already delivered _to that number_ at an
   unguessable UUID URL. A claim token in that message is a possession proof — receiving it
   requires holding the number. No SMS provider, no per-message cost, and it fits the
   architecture already specified.
2. **An SMS provider** (MSG91/Twilio). `SmsNotifier` is a throwing stub ready to implement.

Option 1 is the recommendation: it is free, it is already most of the way built, and it
proves the same thing.

Tracked as **DEBT-011**. UI copy was rewritten so the account page promises only a second
way to sign in — it no longer offers to surface past purchases, because that promise cannot
currently be kept.

---

## D-012 — Rate changes call `revalidatePath` as well as `revalidateTag`

**Spec:** Phase 4 §4.1 — `setRate` calls `revalidateTag('rates')`. MASTER-SPEC §6 — "Admin
mutations call `revalidateTag()` — so a rate change or new product appears without waiting
for the ISR window."
**Actual:** `setRate` calls `revalidateTag(RATES_TAG, 'max')` **and** `revalidatePath()` for
every entry in `RATE_SURFACES` (`/`, `/rates`).

**Reasoning:** on Next 16, `revalidateTag` only invalidates cache entries that carry the
tag, and a tag is attached in exactly two ways — `fetch(url, { next: { tags } })` or
`cacheTag()` inside a `'use cache'` function. The rates pages do neither: they read Postgres
through Prisma and are cached by `export const revalidate = 300`. So the tag matched nothing
and the call was silently inert.

Measured, not inferred. Against a production build (`pnpm build && pnpm start`), setting a
rate through `POST /api/admin/rates`:

| Surface      | Before the fix              | After                   |
| :----------- | :-------------------------- | :---------------------- |
| `/api/rates` | new value immediately       | new value immediately   |
| `/`          | old value for the full 300s | new value, next request |
| `/rates`     | old value for the full 300s | new value, next request |

`/` eventually self-corrected because the ticker refetches over SWR every five minutes.
`/rates` is server-rendered with no client fetch, so it had no way to catch up at all.

The alternative — enabling `cacheComponents` and moving the rate reads into `'use cache'`
functions with `cacheTag('rates')` — would make the tag genuinely load-bearing, but it
changes the caching model for every route in the application and belongs in Phase 9 rather
than in a phase about rate display. `revalidateTag` is kept because §4.1 asks for it and
because Phase 6/7 will introduce properly tagged data; `RATE_SURFACES` is the list Phase 6
extends with `/products/[slug]`.

---

## D-013 — `/rates` shows the true rate, with no jitter

**Spec:** Phase 4 §4.6 lists the page's contents and does not mention the ticker animation.
**Actual:** `/rates` renders static server-side cards on the true admin rate. The jitter is
homepage-only.

**Reasoning:** MASTER-SPEC §8 scopes the fluctuation to "the homepage widget", and `/rates`
is the page a customer opens to check a number before walking into the shop. Adding a second
animated surface would double the consumer-protection exposure DEBT-002 tracks while adding
nothing the homepage does not already do. The disclaimer is still on every card, because the
rate can change between the ISR window and the customer arriving.

A consequence worth stating: `/rates` has no client-side refresh at all, which is why D-012
matters more here than on the homepage.

---

## D-014 — Timestamps are formatted in `Asia/Kolkata`, always

**Spec:** Phase 4 §4.4 — `Indicative rate · Updated 11:42 AM · Final price confirmed in store.`
**Actual:** every timestamp goes through `lib/datetime.ts`, which passes an explicit
`timeZone: 'Asia/Kolkata'`.

**Reasoning:** two reasons, one correctness and one product.

`toLocaleTimeString()` with no `timeZone` uses the _runtime's_ zone. The ticker is a client
component, so it renders once on the server during SSR and again in the browser on
hydration. Render's servers run UTC; the customer's phone runs IST. The same instant
therefore produced `6:12 am` in the server HTML and `11:42 am` after hydration — a React
hydration mismatch that discards the server-rendered tree.

Independently, "Updated 11:42 AM" means _the time the shop set the rate_. A customer abroad
should see the shop's clock, not their own, or the timestamp tells them nothing.

`lib/datetime.test.ts` sets `process.env.TZ` to UTC, New York, Kolkata and Auckland and
asserts the output is byte-identical in all four.

One wrinkle recorded because it will otherwise be rediscovered: CLDR's `en-IN` separates the
time from the meridiem with U+202F, a _narrow no-break space_, and emits `am`/`pm` in
lowercase. Both are normalised in `formatShopTime` — an invisible character that compares
unequal to a space breaks every `toBe('11:42 AM')` assertion while looking correct in a
terminal.

---

## D-015 — `CalculatorShare` added to the data model, in Postgres not Redis

**Spec:** MASTER-SPEC §5 lists the Prisma models; there is no share table. §7's Redis key
map has no share key either.
**Actual:** a new `CalculatorShare` model in Postgres, migration
`20260805132228_calculator_share`.

**Reasoning:** Phase 5 §5.5 requires a link that still resolves in 30 days and still shows
the same price. Redis was the tempting home — §7 already uses TTLs — but a cache is the
wrong place for a durable promise:

- MASTER-SPEC §7 says "Redis being down must degrade to a slow site, never a broken one."
  A share stored only in Redis inverts that: Redis down means every shared link 404s.
- Redis evicts under memory pressure. A link a customer was sent could simply stop
  existing, with no way to tell them why.

The row carries the rate snapshot alongside the items, which is the same reasoning
MASTER-SPEC §5 gives for `OrderItem.ratePerGram`: "A bill must render identically in five
years regardless of today's rate."

The slug is 12 characters of `crypto.randomBytes` from a 28-symbol alphabet (~57 bits) —
the URL is the only thing guarding the link, so MASTER-SPEC's "Bill forgery" control
applies to it as much as to a PDF key. The alphabet excludes vowels, `0/O` and `1/l/I`,
because these links get read aloud and typed by hand.

Expiry is enforced on read, and an expired share is indistinguishable from one that never
existed — saying "this link expired" would confirm which slugs were once real.

---

## D-016 — Phase 5's SECURITY review was run even though the phase file does not list it

**Spec:** `05-calculator.md` heads its agent list "DEV → TEST → DESIGN". AGENTS.md's build
process says "1. DEV 2. TEST 3. SECURITY ... Phase is done when all three sign off".
**Actual:** SECURITY reviewed the phase and signed off.

**Reasoning:** the two documents disagree, and the phase file is the narrower statement.
Independently of the process question, this phase introduces `POST /api/calculator/share`
— **the only endpoint in the application that lets an unauthenticated caller create a
database row.** Skipping a security review of that because a header line omitted it would
be following the letter of a document over its evident intent.

The review is in SECURITY-LOG.md. It found one MEDIUM (public write, unauthenticated,
initially unbounded — rate limited before sign-off) and two INFO items now in DEBT.md.

---

## D-017 — `Enquiry` model added to the data model

**Spec:** MASTER-SPEC §5 lists the Prisma models; there is no enquiry table. Phase 6 §6.3
says "Log the enquiry (product, timestamp, session) for the admin dashboard".
**Actual:** a new `Enquiry` model, migration `20260805144131_enquiry_log`.

**Reasoning:** `AuditLog` was the obvious candidate and is the wrong shape. Its `actorId` is
non-null and means "the admin who did this", whereas almost every enquiry is anonymous.
Overloading it would fill the audit trail with rows that have no actor and make it unusable
for the thing it exists for — reconstructing who changed a rate or sent a bill.

The model is deliberately thin: product, timestamp, source, and a session fingerprint.
§6.3 asks for exactly that, and an enquiry is a signal that a piece drew interest, not a
record about a person. There is no name, number or message text — we do not have them at
that point and should not begin collecting them here.

**On the session fingerprint.** The stored value is an HMAC of the session id keyed on
`SESSION_SECRET`, not the session id itself. The raw id is a credential: `session:{sid}` is
the Redis key, so anyone holding it can set the cookie and become that user. Writing it into
an analytics table would make a leak of that table a session-hijacking kit. The HMAC groups
one visitor's enquiries — which is the whole question the dashboard answers — while being
neither reversible nor replayable.

---

## D-018 — `NEXT_PUBLIC_SITE_URL` added to the environment

**Spec:** MASTER-SPEC §9 lists the environment variables; this is not among them.
**Actual:** added to `lib/env.ts`'s client schema, defaulting to `http://localhost:3000`.

**Reasoning:** §6.3's WhatsApp message embeds an absolute link back to the product, and a
server behind a proxy cannot reliably know its own public origin. The alternative was
reading `window.location.origin` in an effect, which was tried and rejected: it ships server
HTML with the wrong link and corrects it only after hydration, so the link is wrong for a
visitor with JavaScript disabled and briefly wrong for everyone else. It also tripped
`react-hooks/set-state-in-effect`, which was right to complain.

Known at build time, the value is identical on both sides and the href is correct in the
first byte of HTML.

---

## D-019 — The product price breakdown shows paise, not whole rupees

**Spec:** §6.2 illustrates the block in whole rupees (`Metal value … ₹ 61,540`).
**Actual:** every line shows two decimals.

**Reasoning:** rounded components do not add up to a rounded total. On the seeded Temple
Necklace Set the four rounded lines sum to ₹7,47,251 beside a stated total of ₹7,47,252 — a
visible ₹1 gap, found by the E2E assertion that the breakdown reconciles.

§6.2's entire justification for the block is that "showing the working builds trust", and
working that does not add up destroys it faster than showing no working at all. It is also
precisely the "₹1 discrepancy" MASTER-SPEC §4 exists to prevent. §6 DESIGN independently
asks for the column to be "aligned on the decimal", which only means anything if a decimal
is shown.

The engine is unchanged — it was already exact. This is a formatting decision, and it
matches what the Phase 5 calculator breakdown already did.

---

## D-020 — Price filtering and price sorting happen in the application, with a ceiling

**Spec:** §6.1 asks for a price-band filter and price sort.
**Actual:** purity and weight filter in SQL; price filters and sorts are applied in memory
over at most `PRICE_SORT_CEILING` (500) candidates.

**Reasoning:** there is no price column. A product's price is a function of today's rate,
which is the whole point of §6.2 — nothing stored can go stale. That also means SQL has
nothing to sort on.

The alternative is a materialised `pricePaise` column refreshed by `setRate`, which is real
work and a new consistency risk (a rate change that half-updates leaves wrong prices in the
catalogue). For a jewellery shop with a catalogue in the low hundreds, pricing the candidate
set in the application is simpler and always correct. The ceiling exists so the trade-off
degrades loudly rather than quietly if the catalogue outgrows it — tracked as DEBT-019.

---

## D-021 — Demo products in the seed

**Spec:** Phase 7 gives the admin product CRUD; no phase asks the seed for products.
**Actual:** twelve placeholder products, upserted on slug.

**Reasoning:** Phase 6's acceptance criteria are "catalog browsable and filterable" and
"product prices computed live" — neither can be demonstrated or tested against an empty
table, and Phase 7 is a phase away. The spread across purities, weights and price bands is
what makes the §6.1 filters testable at all, and one product is deliberately un-hallmarked
so §6.2's "Hallmark details available in store" fallback has something to exercise.

The upsert updates nothing on a second run, so once the shop starts editing these, re-running
the seed cannot undo their work.

---

## D-022 — `Settings` added to the data model, as a single row

**Spec:** MASTER-SPEC §5 lists the Prisma models; there is no settings table. §7.9 asks for
shop details, defaults, bill numbering and a ticker toggle.
**Actual:** a `Settings` model whose id defaults to the constant `singleton`.

**Reasoning:** the alternative was a key/value table, which turns every typed field into a
string and every read into a parse. One row with real columns keeps `defaultGstPct` a
`Decimal(5,2)` and `billSequence` an `Int`, which is what they are.

The constant id is the trick that makes "one row" true without a check constraint: every
read is `findUnique({ where: { id: 'singleton' } })` and every write is an upsert on it, so
there is no way to end up with two and no question about which is live.

`tickerJitter` is deliberately **nullable**, with three meanings rather than two: null
follows `NEXT_PUBLIC_TICKER_JITTER`, true and false override it. §7.9 asks to "surface the
env flag in the UI so the owner can disable it without a deploy", and a plain boolean would
have silently replaced the deployment default the first time anyone opened the settings page.

---

## D-023 — Reordering is up/down buttons, not drag-and-drop

**Spec:** §7.4 says "drag to reorder" for product images; §7.5 says "drag-to-reorder" for
categories.
**Actual:** up and down buttons that write the same `sortOrder`.

**Reasoning:** on a phone the drag gesture and the scroll gesture are the same gesture. §7's
own design intent is that the admin "will use this on a phone, standing in a shop, between
customers" — and a list that hijacks vertical drags is actively hostile in that context.
Buttons also work with a keyboard and a screen reader, and need no dependency.

The persisted data is identical, so a drag affordance can be layered on later over the same
action without a migration. Recorded rather than silently substituted because it is a
visible departure from what the spec asked for.

---

## D-024 — Admin CRUD uses Server Actions, not route handlers

**Spec:** §7 does not say which. MASTER-SPEC §6 describes `/api/*` route handlers.
**Actual:** `/api/admin/rates` stays a route handler (Phase 4 built it); everything new in
Phase 7 is a Server Action.

**Reasoning:** the admin screens are forms, and a Server Action removes the client fetch
wrapper, the manual JSON encoding and the response-shape duplication that each new screen
would otherwise repeat. `lib/admin/actions.ts` wraps every one with the role re-check, the
origin check, the audit write and error handling, so the audited path is the _easy_ path
rather than a rule to remember.

The explicit origin check stays even though Next validates a Server Action's own origin:
relying on a framework's internal behaviour for a security control is how the control
disappears in a minor upgrade.

One sharp edge worth recording, because it cost time: a `'use server'` file may export
**only async functions**. Exporting a `const SETTINGS_ID` from one broke the entire module
graph, and the symptom was `/admin/audit` — a page that does not touch settings — returning 500.

---

## D-025 — `UPLOAD_PROVIDER_KEY` replaced by three Cloudinary variables

**Spec:** MASTER-SPEC §9 lists `UPLOAD_PROVIDER_KEY=`.
**Actual:** `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, all optional.

**Reasoning:** Cloudinary needs three values and one string cannot hold them. §7.8 offers
"UploadThing or Cloudinary"; Cloudinary is the right pick because §7.8 also asks for
WebP/AVIF conversion, three sizes, a `blurDataURL` and EXIF stripping — all of which
Cloudinary does as signed upload parameters and delivery transformations, and none of which
UploadThing does. Choosing UploadThing would have meant adding `sharp` and building a
derivative pipeline to get back to the same place.

Optional rather than required, so the application still boots without them: §7.6's
paste-a-URL path works regardless, and a missing key disables the upload control instead of
crashing at start. A shop that has not set up an image host should still be able to run the
site.

**No upload preset.** Presets are mandatory only for _unsigned_ uploads. Signing lets the
folder, format allowlist, size cap and EXIF flag travel inside the signature, which puts
them in reviewed, version-controlled code rather than a dashboard setting that can be
changed without a deploy. A parameter outside the signature is one the client can rewrite.

**One sharp edge, recorded because it cost a debugging round.** Cloudinary excludes four
parameters from the signature — `file`, `cloud_name`, `api_key` and `resource_type` — and
including one returns `Invalid Signature` with no indication which. Signing `resource_type`
made _every_ upload fail 401, including a legitimate PNG. That the control case failed too
is what showed it was our bug rather than the security controls working, and removing it
changed the response to a permissions error, which separated the two problems.

---

## D-026 — Bill PDFs are stored in Postgres, not an object store

**Spec:** §8.3 — "Key: `bills/{uuidv4}.pdf` ... Private bucket; served via a signed URL,
7-day expiry, or through an ownership-checked route."
**Actual:** a `BillPdf` table holding the rendered bytes, served by `/bills/{key}`.

**Reasoning:** there is no private bucket in this stack, and inventing one would have meant
either building against credentials that do not exist or adding a storage provider the
project has not chosen. Cloudinary is configured, but it is an image account: `raw` +
`authenticated` uploads on the free tier are plausible and unverified, and Phase 7 already
established that shipping code which has never run is worse than an honest gap.

Postgres is not a compromise here so much as the right shape:

- The bytes commit with the order they belong to, so an order carrying a `billPdfKey` that
  resolves to nothing cannot exist.
- §8.5's retention requirement (DEBT-026) applies to the invoice and the document alike, and
  keeping them in one place means one backup and one restore, not two systems that can
  diverge.
- A rendered invoice is ~6KB. At twenty bills a day that is under 50MB a year, which is not
  a database problem. It becomes one only if the shop starts embedding photographs.

**What would change the answer:** an object store being configured for anything else. The
storage functions are four small exports in `lib/bills/storage.ts`, and the route reads
through them, so moving the bytes is a change to one file. Logged as DEBT-028.

**The key still follows §8.3's shape.** `bills/` is the route prefix, `.pdf` the
`Content-Disposition` filename, and the UUIDv4 is what is stored — the decorations live
where they mean something rather than inside a database identifier.

---

## D-027 — The invoice is set in Helvetica and writes `Rs.`, not `₹`

**Spec:** §8.3 — "Typography and colours from the design tokens."
**Actual:** colours, scale and spacing are tokens. The font family is Helvetica, a PDF base
font, and amounts print as `Rs. 8,03,239.39`.

**Reasoning, and it was measured rather than assumed.** The fourteen PDF base fonts are
encoded in WinAnsi, which has no U+20B9. Rendering `₹` through `@react-pdf/renderer` does
not fail — it emits byte `0xB9`, which WinAnsi maps to `onesuperior` — so a bill would have
printed `¹ 7,47,252.00` and nothing would have complained. Found by inflating the content
stream of a probe render and reading the glyph codes.

Embedding Inter to get one glyph would mean committing a font binary, resolving its path at
runtime through Next's output tracing, and shipping two subsets (the Latin subset does not
contain U+20B9 either; it is in latin-ext). `Rs.` is what most Indian tax invoices print,
and it is unambiguous on a legal document in a way a glyph that might not render is not.

`lib/money.ts` therefore has two formatters over one grouping function — `formatINR` for the
screen and `formatRupeesAscii` for the page — so the two symbols cannot drift apart in their
digit grouping.

**The consequence worth knowing about:** any character outside WinAnsi has the same problem,
including every Indic script. `lib/bills/pdf-text.ts` strips them deliberately rather than
letting the encoder guess, and a name written in Devanagari currently prints as the
placeholder. That is a font gap, not a text gap — DEBT-027.

---

## D-028 — `/bills/{key}` accepts a signature **or** session ownership, not the key alone

**Spec:** §8.3 offers a choice — "served via a signed URL, 7-day expiry, **or** through an
ownership-checked route". DEBT-021 requires the ownership check.
**Actual:** both, and a bare key is refused.

**Reasoning:** the two access paths are genuinely different and neither control covers both.

The WhatsApp recipient **has no account** — that is the whole feature; §8's flow ends with
"Customer later verifies that phone → order attaches". An ownership-checked route cannot
serve them at all, so that link has to be a capability. But MASTER-SPEC's IDOR control is
unconditional — "Every fetch of an order/bill filters by `userId` from the session, never by
an ID from the URL alone" — and DEBT-021 was raised in Phase 6 to make sure Phase 8 honoured
it.

So the route accepts a valid unexpired HMAC signature, **or** a session that owns the order,
**or** an admin session. A correct key with no signature and no session is a 404, which is
exactly what DEBT-021 asked for: the unguessable URL is not the authorisation.

**Why a signature at all, when a UUIDv4 is already unguessable.** §8.3 requires the link to
expire, and a key cannot expire without deleting the bill — which §8.5's retention rule
forbids. The deadline rides in the signature, so the link dies while the invoice lives.

The HMAC is keyed on a value derived from `SESSION_SECRET` with a versioned domain label, so
it cannot collide with Phase 6's enquiry HMAC (SEC-013) on the same secret. Every failure
returns the identical 404 — "no such bill", "bad signature" and "not yours" are
indistinguishable from outside, or the route becomes an oracle for which invoices exist.

---

## D-029 — A twelfth media slot, `BILL_LOGO`

**Spec:** §7.6's table defines eleven slots. §8.3 says "Logo from a MediaSlot."
**Actual:** `BILL_LOGO` added to `MEDIA_SLOTS`.

**Reasoning:** §8.3 assumes a logo slot exists and §7.6's table does not have one, because
nothing on the storefront rendered a logo. The alternative — a twelfth URL field on
`Settings` — would have put an admin-supplied URL outside §7.7's SSRF guard, which is the
highest-risk input in the application. Adding the slot means the invoice logo goes through
exactly the same validated path as every other image the shop can change.

Two Phase-8-specific behaviours hang off it:

- The bytes are cached in Redis for six hours and the slot's save action busts that cache,
  because a bill render must not depend on a third-party CDN answering. Every failure —
  unreachable, wrong format, cache miss during an outage — falls back to a typographic
  wordmark rather than failing the bill.
- PDF embeds JPEG and PNG only. A WebP logo passes §7.7's check, is a perfectly good image,
  and is skipped with a logged reason rather than crashing the renderer. The slot's
  recommendation says so.

---

## D-030 — The WhatsApp bill message carries a claim link, not `/account/orders`

**Spec:** §8.4's template ends `View your purchase history: {siteUrl}/account/orders`.
**Actual:** `See all your purchases: {siteUrl}/claim/{token}` when a token can be minted;
the original line when it cannot.

**Reasoning:** the plain link only does something for a customer who already has an account
with that number verified — which is precisely the customer this message is _not_ for. §8's
own flow diagram ends "Customer later verifies that phone → order attaches to their account
automatically", and until Phase 9 nothing in the application could perform that verification
(DEBT-011). The line was a promise the product could not keep.

The token is minted with the bill and delivered **to the number**, which is what an SMS OTP
would have proven, over a channel the shop already uses and pays nothing for. It is minted
only when the number is not already verified, so a customer who is set up gets the original
line and no dead-end link.

**What this changes about the message's sensitivity.** It already carried a capability — the
signed PDF link — so the message was never safe to forward. It now carries a second one with
a wider blast radius: the PDF is one invoice, the token is every unclaimed purchase on that
number. Single use, seven days, rate limited per number and per IP, and audited. SEC-026.

---

## D-031 — The claim token is derived, not random

**Spec:** the Phase 8 SECURITY review asked for a token that is "unguessable and not
derivable from the invoice number".
**Actual:** `HMAC(key, orderId.phone.expiry)`, base64url, where the key is derived from
`SESSION_SECRET` under a versioned label. Stored hashed and peppered, like `OtpCode`.

**Reasoning:** the token has to be **reproducible**, and a random one cannot be. §8.4 has the
admin send the message from the bill detail page, which may be days after the bill was raised
and may happen twice if they resend — but the token is stored hashed, so a random value can
only be shown once. The alternatives were both bad: mint a fresh token per page view and
accumulate live credentials, or re-mint and silently kill the link already sitting in the
customer's WhatsApp.

Deriving it makes the link stable across views and resends, which is the behaviour the
feature needs. It satisfies the constraint as written — nothing about `orderNo` is an input,
and the key never leaves the server.

**The cost, stated plainly:** an environment leak lets an attacker who _also_ knows an order
id and its phone number mint a token, where a random one would have been worthless. That is a
real reduction. It is accepted because `SESSION_SECRET` leaking is already game over for
every session in the system, the attacker needs two further values to use it, and single use,
the TTL and the rate limits all still apply. `activeClaimToken` re-derives and compares
against the stored hash, so rotating the secret invalidates every outstanding token rather
than handing out links that will not work.

---

## D-032 — Possession beats an unverified assertion, but never a proven one

**Spec:** MASTER-SPEC §5 — "The claim runs only after successful OTP verification of that
exact number."
**Actual:** as specified, plus an explicit rule for the collision that first became reachable
in Phase 9.

`User.phone` is unique, so two accounts cannot hold one number, and until DEBT-011 was closed
nothing ever set `phoneVerified` — so the collision could not arise. With a real caller it
can, and a raw `P2002` would have surfaced as "something went wrong" at the final step of the
flagship flow. The rule:

- **An unverified incumbent is detached.** Somebody typed the number into an abandoned signup
  and nobody ever checked it. The claimant has proven possession; the incumbent has not.
- **A verified incumbent stands, and the claim is refused** with a message pointing at the
  shop. Two people cannot both have proven the same number. The realistic cause is a recycled
  SIM, and silently moving a stranger's purchase history to whoever holds the number today is
  exactly the account takeover §5 warns about — it needs a human, not a policy.

---

## D-033 — The CSP allows `unsafe-inline` for scripts, because a nonce would disable ISR

**Spec:** Phase 9 §9.1 — "CSP with no `unsafe-eval`. `unsafe-inline` for styles only if
Tailwind forces it, and document why."
**Actual:** no `unsafe-eval`, as required. `unsafe-inline` is permitted for **scripts as well
as styles**, which is wider than §9.1 anticipated, and this is the documentation it asks for.

Recorded by SECURITY during the §9.1 pass, before the header set is built, because the
alternative is the recipe Next's own CSP guide shows first and it would be adopted by default.

### Why not a nonce

A nonce is the strictly better policy and this application cannot have one. From
`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`:

> When you use nonces in your CSP, **all pages must be dynamically rendered**. … Static
> optimization and Incremental Static Regeneration (ISR) are disabled.

The storefront is built on ISR — `/` and `/rates` at 300s, `/collections`, `/products/[slug]`
and `/policies/[slug]` at 600s, several prerendered through `generateStaticParams`. Measured on
a production build, `/` and `/rates` both answer `x-nextjs-cache: HIT`. §9.2 sets LCP < 2.0s
and TTFB < 400ms on throttled 4G and asks explicitly for that header to be verified. Adopting a
nonce would satisfy §9.1 and make §9.2 unreachable, silently — nothing errors, the site simply
stops being cached.

There is a sharper failure underneath the performance one. A nonce baked into a **cached** page
is a fixed string while the header sent with each request is fresh, so every request after the
first serves HTML whose nonce does not match and the browser blocks every script: the page
renders and never hydrates.

### Why the inline scripts cannot be covered another way

Measured against the built output rather than assumed. A prerendered page contains **four
inline `<script>` tags** carrying the RSC flight payload, with no nonce and no `integrity`
attribute; `script-src 'self'` alone blocks them.

Next's experimental SRI does not help. In
`next/dist/server/app-render/required-scripts.js` the SRI manifest is applied to external
bootstrap and preinit scripts **by `src`**, while the inlined data stream is nonce-only —
`integrity` is not a property an inline script can have.

So for a statically rendered Next App Router page the choices are `unsafe-inline` or no
hydration.

### What the concession actually costs here

`unsafe-inline` matters when an attacker can get markup into a page. This codebase has no
`dangerouslySetInnerHTML` anywhere in `app/`, `components/` or `lib/`, no `eval`, no
`new Function`, no user-supplied HTML rendered anywhere, React escaping throughout, and no
CDN-loaded scripts. The CSP here is defence in depth against a future mistake, not a control
holding a known gap shut — which is a materially different bargain from an application that
renders user content.

Everything else in the policy stays strict: no `unsafe-eval`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` (the modern form of the
`X-Frame-Options: DENY` already present), and `img-src` limited to `self`, `data:`, `blob:` and
the `ALLOWED_IMAGE_HOSTS` entries.

### The escape hatch, if a strict `script-src` is wanted later

`/admin/*`, `/account/*` and `/claim/*` are already `force-dynamic`, so a nonce costs nothing
on exactly the surfaces where it is worth the most. A second, tighter policy scoped to those
paths is available at any time. Two rules if it is taken: emit exactly **one** CSP header per
response — two are enforced as an intersection and produce confusing breakage — and never set
the CSP on the _request_ headers for a cacheable route, which is what bakes a nonce into cached
HTML.

---

## D-034 — `@next/bundle-analyzer` needs `next build --webpack`; Turbopack silently writes nothing

**Phase 9 §9.2.** The checklist says "`@next/bundle-analyzer`; remove anything unjustified."
On Next 16 that instruction does not work as written, and it fails in the quiet way:

```
The Next Bundle Analyzer is not compatible with Turbopack builds, no report will be generated.
```

Next 16 builds with Turbopack by default, so `ANALYZE=true next build` compiles successfully,
prints that line among the build output, and produces no report. A checklist item ticked on
that basis would be measuring nothing — the same failure shape as the tests this phase kept
finding.

Two routes exist and both were tried. `next experimental-analyze` is Next's own replacement;
it ran for over ten minutes without producing output and was abandoned. `next build --webpack`
still works in Next 16 and the analyzer works with it, so `pnpm build:analyze` pins that flag.

**One caveat on every number it produces:** it analyses a _webpack_ build, while production
ships _Turbopack_ output. Module attribution is indicative, not exact. The per-route totals in
the §9.2 report are therefore measured over the wire from a real production build rather than
read off the analyzer.

A second, unrelated trap comes with the flag: a webpack build regenerates `.next/types` more
strictly than Turbopack and surfaced `TS2344` on `app/api/rates/history/route.ts` exporting
`MAX_HISTORY_DAYS`. That error does **not** reproduce on a Turbopack build and disappears once
`.next/types` is regenerated. Delete `.next/types` after running the analyzer, or `pnpm
typecheck` will fail on an artefact rather than a defect.

## D-035 — the §9.2 JS budget of 180 kB is not reachable on this stack

**Measured, not estimated.** A production build served on `next start`, driven by a real
browser at Lighthouse's mobile profile (1.6 Mbps, 150 ms RTT, 4× CPU), counting
`encodedDataLength` — bytes on the wire after compression, which is what "gzipped" means:

| Route              | First-load JS |
| :----------------- | ------------: |
| `/`                |      278.6 kB |
| `/rates`           |      278.6 kB |
| `/collections`     |      278.6 kB |
| `/products/[slug]` |      282.5 kB |
| `/calculator`      |      278.6 kB |

The figure is essentially constant across routes, which is the finding: it is not route code.
Analyzer attribution, gzipped: **`next` 245 kB**, **`react-dom` 55 kB**, app code 100 kB,
`lucide-react` 23 kB, `vaul` 20 kB, `zod` 19 kB, `sonner` 9 kB.

The framework floor alone exceeds the budget. Every removable dependency in the list totals
about 70 kB, and removing all of them — which would mean no bottom sheets, no icons and no
toasts — still lands near 210 kB.

**The first guess was wrong and is worth recording.** The obvious hypothesis was that a
server-only library had leaked into a client chunk; `@react-pdf/renderer`, `pdfkit`, Prisma,
argon2 and `libphonenumber-js` were each checked for and none is present. Icons are imported
per-symbol, so tree-shaking is already correct. There is no bloat to remove; there is a
framework baseline.

**One optimisation was tried and reverted.** Deferring `sonner` behind `next/dynamic` made
first-load _larger_ — 278.6 kB → 281.0 kB. `<Toaster />` mounts in the root layout, so the
lazy chunk is requested on load anyway and the wrapper is pure overhead. Recorded because it
looks like an obvious win and is not.

**Resolved: the owner accepted ~280 kB as the floor** for a Next 16 App Router storefront, and
§9.2's budget is amended to **290 kB** rather than deleted. The margin is deliberately thin —
12 kB over the measured 278.6 kB — so the line still fails on a real regression instead of
becoming decorative. Raising a budget to meet an implementation is normally how budgets stop
meaning anything; what makes it defensible here is that the measurement came first, the
attribution names every kilobyte, and the alternative was changing frameworks.

The other five lines pass and were never in question.

---

## D-036 — the dashboard money tiles run full width below 640px, rather than shrinking or abbreviating the figure

**Raised as:** DEBT-038 — `/admin` overflowed at 375px once the shop's figures passed ₹1
crore. DEBUG diagnosed it to the element and left the remedy to DESIGN, naming three
candidates: stack the tiles, drop a step on the §3 type scale, or abbreviate to `₹1.14 Cr`.

**Measured first, because two of the three candidates fail on measurement.** A half-width
tile at 375px is a 160px card with 24px padding, so the figure gets **112px**. Rendered text
width in the tile's own font, from a `Range` around the text node:

| Figure          |            | at 24px (`h2`, today) | at 20px (`h3`) | at 16px (`body`) |
| :-------------- | :--------- | --------------------: | -------------: | ---------------: |
| `₹99,999`       | ₹1 lakh    |               97.6 ✅ |        81.3 ✅ |          65.0 ✅ |
| `₹9,99,999`     | ₹10 lakh   |              119.5 ❌ |        99.6 ✅ |          79.7 ✅ |
| `₹99,99,999`    | ₹1 crore   |              135.1 ❌ |       112.6 ❌ |          90.0 ✅ |
| `₹9,99,99,999`  | ₹10 crore  |              157.0 ❌ |       130.9 ❌ |         104.7 ✅ |
| `₹99,99,99,999` | ₹100 crore |              172.6 ❌ |       143.8 ❌ |         115.0 ❌ |

**The defect is older and larger than the ticket says.** At the current type step the widest
figure that fits a half-width tile is `₹99,999`. The grid has therefore been too narrow since
the shop's totals passed **₹1 lakh**, not ₹1 crore; a crore is merely where the overflow grew
past the viewport and tripped the E2E assertion. The seeded average order — `₹2,47,796` — does
not fit either, and never did.

**Why not the type step.** One step down (`h2` → `h3`) still overflows at a crore, by 0.6px.
Reaching a crore needs `body` — 16px — which is one pixel above the floor DESIGN's mandate
sets, stops the figure being a headline at all, and still fails at ₹100 crore. It buys one
order of magnitude for the whole visual hierarchy of the screen.

**Why not abbreviation.** `₹1.39 Cr` fits comfortably, and it is what a consumer analytics
dashboard would do. This is not one: it is the till. The owner opens `/admin` to see what the
shop took, and `₹1.39 Cr` is not that number — it is a rounding of it that happens to look
like a number. Every other money surface in this application shows exact rupees, and the one
screen where the money is the owner's own is the wrong place to start rounding.

**Chosen: give the figure the room.** The five money tiles span the full row below `sm`
(640px) and pair up again above it; the two count tiles stay paired at every width, because a
count is short and the measurement says so. The full-width inner box is **287px**, which holds
`₹9,99,99,99,999` (₹1000 crore, 194.5px) with 92px to spare — so this does not need revisiting
as the shop grows.

It also follows DESIGN's own mandate in AGENTS.md, which had already answered the question:
_"If a section feels tight, the fix is more padding, not smaller text."_ Nothing is lost —
type scale unchanged, precision unchanged, `tabular` unchanged — and one thing is gained:
five figures in a single column share a left edge, so they compare by eye, which the 2-up
grid never allowed.

**Cost, stated plainly:** about 180px more scrolling on the dashboard at 375px.

**The regression test does not trust the data.** DEBT-038 hid inside an empty database for two
phases, so `e2e/admin.spec.ts` substitutes a ₹1000-crore figure into every money tile and a
five-digit count into every count tile, then measures. It fails against the pre-fix layout
with `"Sold today" is 195px of figure in a 112px box`.

---

## D-037 — `defaultGstPct` is live pricing input; `defaultMakingPct` is only a prefill

**Raised as:** DEBT-024 — Phase 7 §7.9 stored both figures and no pricing surface read either
of them. Phase 8 wired `billPrefix` and the shop identity block onto the invoice, which left
these two as the last write-only settings in the application.

**Why it waited for Phase 9.** DEBT-001. Until the client's CA confirmed that making charges
sit inside the taxable value, the GST _base_ was contested — and making the _rate_
configurable while the base was unsettled would have produced invoices that were wrong in two
independent ways at once, with no way to tell which. DEBT-001 closed, so the base is fixed and
the rate is safe to move.

**The two fields are not a pair, and treating them as one would be a bug.**

| Setting            | Role                                                                      | Read by                                                                           |
| :----------------- | :------------------------------------------------------------------------ | :-------------------------------------------------------------------------------- |
| `defaultGstPct`    | **Live input.** Changing it changes what every customer sees, immediately | product cards, product page, search, calculator, bill lines with no explicit rate |
| `defaultMakingPct` | **Prefill only.** Changing it must reprice nothing that already exists    | a new calculator line, a new bill line, a new product form                        |

A product carries its own `makingPct` column and a bill line carries its own snapshot, so
making is _per item_ and the setting is only the figure a blank form starts at. GST is not
stored on a product at all — the price is a function of today's rate and today's rate of tax —
so that one is genuinely live. `lib/settings.ts` keeps the two roles apart in its own docstring
rather than exposing an undifferentiated "settings" object that invites a caller to use the
wrong one.

**Already-raised bills are untouched, and that is structural rather than careful.** §8.2
snapshots `ratePerGram`, `makingPct` and `gstPct` onto every `OrderItem` inside the
transaction. Whatever the default resolves to at the moment a bill is raised is frozen onto
that bill, so an invoice reprints identically years later. Without that snapshot rule this
setting could not have been made configurable at all.

**Shape of the wiring.** `getPricingDefaults()` is cache-aside on Redis (300s, the same window
as rates) and falls back to `SPEC_PRICING_DEFAULTS` — MASTER-SPEC §4's 3% and the commonest
§5.4 making chip — when there is no row. It reads through `cached()`, which never throws, so a
Redis outage degrades to a Postgres read.

Three consequences worth stating:

1. **`priceProduct(row, rates, gstPct)` takes the rate as a required parameter** rather than
   reading settings itself. A page renders 24 cards; a lookup inside the pricer would be 24
   lookups, and the function would have to become async and stop being unit-testable without
   I/O. Required rather than defaulted, so a new call site is a compile error instead of a
   silent 3% — which is the exact failure mode this decision closes.
2. **The calculator reducer carries the defaults in its state.** `ADD_ITEM`, `CLEAR_ALL` and
   the last `REMOVE_ITEM` all mint blank lines long after the component that knew the settings
   was consulted, and a reducer that reached outside itself for them would stop being the pure
   function of `(state, action)` that §5.3 chose `useReducer` to get. A restored draft keeps
   its own per-item figures — a settings change applies to the next blank line, never to the
   estimate someone is already looking at.
3. **`/calculator` is now ISR 300 rather than prerendered once.** It reads the prefill
   server-side, so it joins `SETTINGS_SURFACES` and refreshes on a settings change the way the
   rate surfaces refresh on a rate change. It is still a static shell around a client island;
   MASTER-SPEC §6's requirement is unchanged.

**The invalidation follows `setRate`'s ordering exactly** — drop the cache, _then_ revalidate
the pages. D-012 records why: a page regenerated first reads the stale value and re-caches it
for its whole ISR window, which Phase 4 measured rather than guessed.

---

## D-038 — four tokens darkened against measurements of the RENDERED palette, not the pair list

**Raised as:** Phase 9 §9.7, "Contrast verified on the final palette." Phase 2 had already
verified contrast and D-007 had already fixed the two failures it found, so this was expected
to be a re-run. It was not.

**What Phase 2 checked, and what it could not.** `lib/design/contrast.test.ts` asserts nine
pairings — each token against cream, and white against the button backgrounds. Every one
passed, and still passes. But an application does not render a token against a token. It
renders `text-muted` on a `bg-taupe-lt/50` track, `text-up` on a `bg-up/10` badge, and a
monogram at `text-taupe/60` over a tint of the same family. **`axe` measured the composited
values and found 97 failing nodes across twelve distinct pairs**, none of which was on
Phase 2's list, and none of which could have been: they do not exist until something is laid
on top of something else.

| Composition                        | Measured | Cause                                           |
| :--------------------------------- | -------: | :---------------------------------------------- |
| `taupe/60` on the frame's own tint |   1.83:1 | brand colour at 60% over a tint of itself       |
| `up` on its own `bg-up/10` badge   |   3.01:1 | verified at 3:1 as "non-text", rendered as text |
| `taupe` on cream (eyebrow labels)  |   3.30:1 | D-007 already said this; three labels did it    |
| `muted/80` on a card               |   3.43:1 | alpha applied to a token verified at full       |
| `muted` on the segmented track     |   4.18:1 | verified on cream, rendered on a tint           |
| `taupeDeep` as text on cream       |   4.35:1 | verified as a background, used as a foreground  |

**The fix is lightness only, on four tokens.** Hue and saturation are untouched in every
case — the method D-007 used — so nothing shifts as a colour:

| Token       | From      | To        | Worst pairing, after |
| :---------- | :-------- | :-------- | -------------------: |
| `taupeDeep` | `#9B694E` | `#96654B` |            4.62:1 ✅ |
| `muted`     | `#756C66` | `#6E6560` |            4.64:1 ✅ |
| `up`        | `#0E9F6E` | `#0A7551` |            4.66:1 ✅ |
| `down`      | `#E02D3C` | `#C61D2B` |            4.63:1 ✅ |

Each was found by walking lightness down until **every** surface that token actually sits on
clears 4.5:1, with the target set at 4.6 so a sub-pixel blend cannot tip it back. Nothing
regresses: `taupeDeep` as a button background improves from 4.64 to 4.93 at the same time,
because both of its jobs want the same direction.

**`taupe` did not move, and three labels did.** Plain `taupe` is 3.30:1 on cream and cannot
be body text on any surface in this palette. That is D-007's finding restated; §9.7 found the
section eyebrow doing it on every heading in the site. The token is the brand accent and stays
exactly as it is — the LABELS moved to `taupeDeep`.

**The monogram was the worst pair and could not be solved with a colour.** At 1.83:1 the "TJ"
in an empty `ImageFrame` was the least legible text in the application. Its wrapper is already
`aria-hidden`, and axe still flags it — correctly, because contrast is about what a sighted
low-vision user can see, and marking something decorative does not make a smudge legible.
No taupe reaches 4.5:1 on that tint (`taupeDeep` manages 4.13), a stronger tint makes it
_worse_, and a fourth taupe token for a placeholder is disproportionate. It is `muted` now:
4.76:1 at any frame size, with the tile's brand signal — the taupe tint — untouched.

**The suite that missed this now cannot.** `composite()` computes the blended surfaces in
`lib/design/tokens.ts` so an alpha changed in a component and not thought about is a test
failure; the mirror check gained its missing direction, so a colour ADDED to `globals.css`
and never mirrored fails rather than going unchecked; and `e2e/a11y.spec.ts` measures the
real thing in a browser, which is what proves the Node-side list is complete.

---

## D-039 — the ticker's live region carries the true rate, and the shimmer is hidden from assistive technology

**Raised as:** Phase 9 §9.7, "Ticker changes announced via `aria-live="polite"` — polite, not
assertive. A per-second assertive region is unusable with a screen reader."

**The checklist item was already satisfied, and the requirement was not.** The figure carried
`aria-live="polite"` and `aria-atomic="true"`, exactly as written. It was still unusable, for
two reasons:

1. **Politeness governs interruption, not volume.** `TICK_INTERVAL_MS` is 1000, so the region
   gained a queued announcement every second. Polite means the reader waits for a pause before
   speaking; it does not mean it speaks less. A queue that gains an entry per second never
   drains, so the practical result is a screen reader that reads a rupee figure forever and
   never gets to the rest of the page. The spec's word for an assertive version of this —
   "unusable" — applies to the polite version too.

2. **Every announcement would have been a number that is not the price.** The jitter is a
   cosmetic shimmer (MASTER-SPEC §8); the calculator and every bill use `truth`, and D-002
   records the consumer-protection reasoning behind that separation. Reading the jittered
   figure aloud would have made a screen reader **the one surface in the application that
   states a fabricated rate as fact** — not merely annoying, but the exposure DEBT-002 exists
   to contain, aimed at the users least able to see the "indicative rate" disclaimer sitting
   next to it.

**Chosen: split the visual channel from the announced one.** The displayed figure is
`aria-hidden="true"` — it is decoration, and it says so. A visually hidden sibling carries
`{metal}: {true rate} {unit}` in a polite atomic region, so a screen reader announces the real
price and re-announces it only when the shop changes it (at most once per 5-minute SWR
refresh). Sighted users see exactly what they saw before.

**Tested by the thing that would regress.** `e2e/screen-reader.spec.ts` watches both channels
over six seconds and asserts the announced text takes **one** distinct value while the
displayed text takes more than one. The second half is the positive control: without it the
assertion would pass just as green against a ticker that never started, which is the failure
mode Phase 4 TEST recorded and guarded against for the same component.

---

## D-040 — the product page's price disclaimer is the shared component, not its own sentence

**Raised as:** Phase 9 §9.6, "Rate disclaimer present on the homepage, `/rates`, and every
product page." Expected to be a verification; it was a defect.

**All three surfaces had a disclaimer. Two of them had the same one.** Phase 4 extracted
`RateDisclaimer` for exactly this reason — §4.6 required `/rates` to carry "the same
disclaimer as the ticker card", and the DEV note recorded the argument in one line: _"two
copies of a legal notice drift within a month."_ Phase 6 then wrote the product page's price
block and gave it a third wording:

| Surface      | Text                                                                     |
| :----------- | :----------------------------------------------------------------------- |
| Ticker (`/`) | Indicative rate · Updated 11:42 AM · **Final price confirmed in store.** |
| `/rates`     | Indicative rate · Updated 11:42 AM · **Final price confirmed in store.** |
| Product page | Price indicative · based on today's rate                                 |

**What drifted is the half that does the work.** "Indicative" describes the number;
"final price confirmed in store" is the sentence that tells a customer the shop is not
bound by it. MASTER-SPEC §8 treats the disclaimer as the mitigation for showing a price the
shop will not necessarily transact at, and DEBT-002 records the owner accepting the residual
risk **on the basis that the mitigations stand**. The weakest wording was on the page where a
customer is closest to acting on the figure — beside a total, under a working breakdown, above
an enquiry button.

**Fixed by deleting the sentence rather than editing it.** `PriceBreakdown` renders
`RateDisclaimer` and takes the rate's `effectiveAt` as a prop. That timestamp is the piece's
own purity — a customer looking at a silver piece is told when the SILVER rate was set, not
when the shop last touched gold — which the block could not show before, because it never had
the timestamp.

**The E2E was complicit and is fixed too.** `catalog.spec.ts` asserted `/Price indicative/`,
which passed against the weaker copy and would have passed against anything containing those
two words. It now asserts the sentence that was missing.

---

## D-041 — the legal pages describe the system; they do not invent the shop's commitments

**Raised as:** Phase 9 §9.6, "Legal pages: privacy, terms, refund/exchange, shipping."

**The precedent, and where it stops.** DEBT-018 settled how this project writes policy copy:
buyback and exchange state that a policy exists and that terms are confirmed in store, and
state no percentages, because those are the owner's commercial commitments and inventing
plausible ones would be fabricating a contract. §9.6's four pages are not the same kind of
document, and applying that rule unchanged would have produced four pages saying nothing.

**A privacy policy is a statement of fact about a system, and a wrong one is a lie told at
scale.** So it was written from the implementation rather than from a template, and every
claim on it is checkable in this repository:

| Claim on the page                                      | Where it comes from                      |
| :----------------------------------------------------- | :--------------------------------------- |
| Passwords hashed with Argon2id, unreadable by anyone   | §3.1, `lib/auth/argon2.ts`               |
| One-time codes stored hashed, 5-minute TTL, single use | §3.2, D-010                              |
| One cookie, a random id, HttpOnly and Secure           | §3.3 — an opaque session, not a JWT      |
| Enquiries logged against a one-way identifier          | SEC-013, an HMAC keyed on SESSION_SECRET |
| No analytics, no ad network, no cookie banner needed   | there is none in the codebase            |
| Invoices kept indefinitely                             | DEBT-003 (owner), DEBT-026 (GST)         |

**The shipping page says the shop does not ship, because it does not.** That is not a
placeholder. DEBT-034 records the same fact from the tax side: every bill is split CGST/SGST,
which is only correct for an intra-state counter sale.

**There is no invented refund window.** For an over-the-counter jeweller, buyback and exchange
ARE the routes by which a piece comes back, and the refunds page says so and links to them. A
distinct cash-refund policy — a window, conditions, deductions — is the owner's to state, and
is **DEBT-043** rather than a sentence written on their behalf.

**Two sentences commit the shop rather than describe the build**, and are flagged for the
owner in SIGNOFF: _"We do not sell your details, and we do not share them with anyone for
marketing"_ and _"We do not ship."_ Both are true of what has been built. Only the owner can
ratify them as policy.

---

## D-042 — the §9.3 jobs run in Node, and `backend/celery_app/` stays dormant

**Raised as:** Phase 9 §9.3, "Activating Celery — the dormant infrastructure from Phase 1 now
earns its keep." MASTER-SPEC §2 names Celery for backend jobs and lists PDF generation as one
of them. AGENTS.md makes deleting the package a hard rule violation.

**The obstacle is not preference; it is that three of the five tasks are TypeScript.**

| §9.3 task               | What it would have to call                                                                |
| :---------------------- | :---------------------------------------------------------------------------------------- |
| `bills.generate_pdf`    | `lib/bills/render.ts` → `@react-pdf/renderer`, React components, `lib/pricing.ts`, Prisma |
| `notify.retry_failed`   | `lib/notify/` → Resend over HTTPS (D-011)                                                 |
| `media.process_image`   | Cloudinary transforms driven from TypeScript (§9.2)                                       |
| `rates.rollup_history`  | SQL only — Python could                                                                   |
| `cleanup.expire_shares` | SQL only — Python could                                                                   |

Putting the first one in Python means **a second implementation of the invoice**. §8 forbids
that in as many words — _"Three implementations of GST rounding is three different totals on
the same purchase, and the customer will find it"_ — and it would duplicate DEBT-027's
unfinished Indic-font work into a second renderer nobody would remember to fix twice.

The last two are genuinely Python-shaped, and using Celery for only those would mean **two
queue technologies, two schedulers and two dead-letter queues** in a shop with 25 products.
That is worse than either option alone. Note also that the worker container has only
`REDIS_URL` — it has no database access at all today, so even the "easy" two are not free.

**Chosen: `lib/queue/` on BullMQ, against the same Redis, worked by `pnpm worker`.** Every
job calls the existing, tested function. The Celery package is untouched: still in
`docker-compose`, still connected, still running `health.ping`, still undeletable. Its README
now carries this reasoning so the next reader does not "finish" a migration that was decided
against.

D-035 set the standard for departing from something the spec wrote down — state the
measurement, state the reasoning, do not quietly edit the spec — and this follows it.

### The bug this design had, and how the test found it

`enqueueOrRun(queue, name, payload, run)` makes §9.3's "degrade gracefully if the worker is
down" structural: `run` is a **required** parameter, so there is no API that enqueues without
saying what to do instead, and the fallback is by construction the same function the worker
would have called.

The first version awaited `queue.add()` inside a `try`. Against a dead broker it did not fall
back — **it hung**. BullMQ builds its own ioredis client and forces `maxRetriesPerRequest:
null` (retry forever), because its blocking commands require that; `enableOfflineQueue: false`
on the passed options does not survive it. So `add()` never rejects and the `catch` is never
reached. `lib/queue/queue.test.ts` caught it against `redis://127.0.0.1:1` — both degradation
cases timed out at 20 seconds instead of falling back in milliseconds.

**This is SEC-008's shape, one layer out.** Phase 4 found `enableOfflineQueue: true` measuring
13.4s per call against a dead Redis and rejected it as "a setting that turns _Redis is down_
into _the site is down_". Same failure, same conclusion.

Fixed with a **1-second deadline** rather than a connection flag, which is the stronger
control: it bounds the request path regardless of _why_ the broker is slow — down, wedged,
failing over, saturated — where a flag only covers "refused". The file now runs in 2.8s
instead of 40.

The cost is stated rather than hidden: a push that lands after the deadline runs the job
twice, once inline and once on the worker. That is precisely why §9.3 requires every task to
be idempotent, and each handler in `lib/queue/jobs.ts` says how it achieves it — a duplicate
render overwrites the same PDF key, a duplicate sweep deletes nothing.

---

## D-049 — the applied-throttling measurement governs, not Lighthouse's simulated model

**Raised as:** DEBT-039. §9.2's acceptance criterion 1 asks for "Lighthouse mobile ≥ 90 on all
key routes". The homepage does not reach it and, across five runs, never has: 79 / 81 / 86 /
86 / 86 on performance alone.

**Two measurements of the same page load, 3.3 seconds apart.**

| Method                                       | Homepage LCP | Source                        |
| :------------------------------------------- | -----------: | :---------------------------- |
| Lighthouse default (simulated / Lantern)     |        4.0 s | `pnpm lighthouse`             |
| Applied throttling — 1.6 Mbps, 150ms RTT, 4× |   **676 ms** | §9.2's own Web Vitals harness |

The applied figure is the method §9.2 used for every other line in its budget table, and it
sits comfortably inside the 2.0s the same table sets for LCP. The LCP element is the hero
`<img>`, recorded at its blur-placeholder paint — §9.2's own work is what makes it fast.

**Two explanations were ruled out before this was treated as a modelling gap**, and neither
was assumed: it is not the cold `/_next/image` path — warming every image variant with a real
browser load first moved the score only 79 → 87 — and it is not general slowness, since FCP is
1.4s, TBT 20–30ms, CLS 0 and Speed Index 1.4s.

**The owner's decision: the measurement governs.** The Lighthouse score is recorded as a model
artefact rather than the contract, and §9.2's criterion 1 is **amended in the spec file, not
quietly dropped**. D-035 set that standard when the JS budget moved from 180KB to 290KB —
state the measurement, state the reasoning, involve the owner — and this follows it.

**What the decision does not do.** It does not excuse the remaining §9.2 items: compression and
a CDN are still worth doing, on their own merits, and are simply no longer being spent to chase
a number. It does not touch the other four key routes, which pass ≥90 regardless. And it does
not close **DEBT-041** — every Lighthouse figure in this project comes from a single run, and
`/products/[slug]` measures 91 / 87 / 93 / 90 / 90 across repeats, straddling the threshold.
That is a methodology defect that survives whichever figure is authoritative, and the fix is
median-of-N rather than a different number.

---

## D-050 — three owner decisions closing the last of Phase 9's policy questions

Recorded together because they were taken together, on the owner's instruction, and each
closes a ticket rather than changing code.

**DEBT-043 — refunds.** Buyback and exchange are the whole story; money is not returned. A
piece comes back as value against another piece, assessed in store against the weight and
purity on the original bill. `/policies/refunds` already says exactly that and states no
cash-refund window, so **the page IS the policy** rather than a placeholder for one — the same
status DEBT-018 gave the buyback and exchange copy. Nothing changes in the code. Two things
travel with it: every sentence on that page is a claim a customer may rely on, and a _stated_
policy is binding under Indian consumer-protection rules, so if the shop ever does return money
the page must change **before** that happens, not after.

**DEBT-046 — analytics.** None. Nothing is added, and three properties hold as a decision
rather than as an accident: §9.1's CSP keeps **no third-party script origin at all**, §9.6's
privacy page keeps its sentence that there is no analytics service and no tracker on the site,
and no cookie-consent banner is ever required. The shop is not blind — §6.3's enquiry log
records which product each WhatsApp enquiry came from, which for this business is a more
actionable signal than pageviews. If it is ever revisited, the CSP, the privacy page and
(unless the tool is genuinely cookieless) a consent banner all change in the same commit.

**The two ratified sentences.** §9.6 wrote two lines that commit the shop rather than describe
the build, and flagged both for the owner. Both are now ratified as policy:

- _"We do not sell your details, and we do not share them with anyone for marketing."_ True of
  the build — there is no data-sharing code — and now a promise as well as a description.
- _"We do not ship. Every piece is collected in store."_ Consistent with DEBT-034, which
  records the same fact from the tax side: every bill is split CGST/SGST, which is correct only
  for an intra-state counter sale. **If the shop ever posts a piece to another state, this
  sentence and the tax split both become wrong**, and DEBT-034 is the ticket for the second.

---

## D-051 — the backup is a command in this repository, not only the platform's snapshot button

**§9.5 asks for daily backups with 30-day retention and, harder, for the restore to have been
tested.** Render's managed Postgres takes its own daily snapshots, and those remain the
primary. `pnpm backup` exists alongside them for two reasons that a provider snapshot cannot
cover:

1. **A provider snapshot can only be restored back into that provider.** It is a recovery
   mechanism, not a portable artefact. The day the answer to "can we get the invoices back" is
   "we would have to ask Render", it is already too late to find out.
2. **It cannot be tested.** §9.5's second item is the load-bearing one — "an untested backup is
   a hope, not a backup" — and testing means restoring somewhere and comparing. `pnpm
verify:restore` restores into a scratch database on this machine and diffs five properties
   against the source.

### What is compared, and why those five

The failure worth designing against is not a dump that crashes. It is a dump that succeeds,
restores with zero errors, and is **missing something**. Three ways that happens in this
schema specifically:

- **`BillPdf.bytes` is `bytea`** holding 91 rendered invoices (D-026). Binary is where dump
  and restore pipelines corrupt silently. Compared by digest — `md5(bytea)` computed
  server-side and aggregated in `key` order — not by row count.
- **Money is `bigint` paise** (MASTER-SPEC §4). A restore landing `numeric`, or truncating,
  still counts the right number of rows.
- **Expression and GIN indexes are invisible to Prisma's schema diff.** DEBT-023 found
  `Product_name_trgm_idx` had been silently dropped and nothing failed for two phases, because
  at 25 products a sequential scan is the correct plan. A restore is the other way to lose it.

Plus exact `count(*)` per table — not `pg_stat_user_tables.n_live_tup`, which is an autovacuum
estimate and reads 0 on a freshly restored database, so that check would have passed by
accident — and the `_prisma_migrations` ledger, without which the next deploy re-runs
everything.

**Mutation-checked**, because a verification that cannot fail is worth nothing: a dump taken
with `--exclude-table-data BillPdf` restores with zero errors and fails exactly two checks
(row counts, PDF digest) while the other three stay green.

### The dump runs as the owner, and that is deliberate

SEC-029 dropped the runtime role to `SELECT`/`INSERT`/`UPDATE` with no `DELETE` on the invoice
tables. `pg_dump` as that role would **succeed** and quietly omit what it could not read —
a file of the right shape and the wrong contents, which is the worst outcome available here.
`MIGRATE_DATABASE_URL` is used, falling back to `DATABASE_URL`.

### What is not done

The schedule and the off-box copy. A backup on the same disk as the database survives a bad
migration and nothing else, and these dumps are personal data (DEBT-031) so the copy has to be
encrypted at rest. Both are ops, both are DEBT-049, and the cron line is printed by
`pnpm backup --help` rather than described.

---

## D-052 — a password reset is delivered to the account's email whatever the customer typed

**Found by killing the dependency, which is the only way it could have been found.**

`/api/auth/password/forgot` chose its channel from the shape of the identifier: an email went
to `Channel.EMAIL`, a phone number to `Channel.SMS`. There is no SMS provider (D-011) and
`SmsNotifier.send` throws. So the phone branch had never worked — and worse, it broke the one
property the endpoint exists to have.

§3 requires this route to answer identically whether or not the account exists, because
otherwise it is an unauthenticated oracle over the customer list. It does that by always
returning the same generic 200 with padded timing. But **the send only runs on the branch
where the user was found**, so the exception only ever fired for a real account:

| identifier                | before  | after |
| :------------------------ | :------ | :---- |
| registered phone number   | **500** | 200   |
| unregistered phone number | 200     | 200   |

Anyone could test a list of Indian mobile numbers against this endpoint and read the shop's
customer list off the status codes. `pnpm verify:degradation` reported it as `500 vs 200`.

### The fix, and the part of it that is not obvious

Delivery goes to `user.email`. The OTP stays **keyed on what the customer typed**, so the code
they receive verifies the identifier they gave — getting that backwards would send a working
code that the reset step then refuses. `/api/auth/phone/start` has always worked this way
(§3.7); this route was the outlier.

The second half matters more. **A delivery failure is caught, logged and does not change the
response.** That is not the codebase's usual rule — everywhere else an exception becomes a 500
— and the reason for the exception is that here the response is a security property. Any error
escaping delivery re-opens the oracle at exactly the moment the provider is unhealthy: a Resend
outage, an expired key, a rate-limited sender. Nothing is swallowed; the error is logged
redacted (DEBT-036) and reaches Sentry like any other.

**The cost, stated:** a customer whose email genuinely failed is told a code is on its way and
never gets one. They can retry. The alternative leaks the customer list, which they cannot undo.

### What this does not do

It does not add SMS. When a provider is finally wired, the channel choice comes back — and the
generic-response guarantee must survive it, which is what the provider-outage test in
`app/api/auth/password/forgot/route.test.ts` is there to hold.

---

## D-053 — §9.2's dynamic-import item is closed by measurement, not by splitting something

§9.2 asks to "dynamic-import heavy client components (bill builder, charts, PDF viewer)".
Measured before deciding, in a real browser counting `encodedDataLength` on script responses
— the method D-035 established:

| Route                                 | First-load JS |
| :------------------------------------ | ------------: |
| `/` storefront home                   |      271.8 kB |
| `/calculator`                         |      271.4 kB |
| `/products/[slug]`                    |      265.1 kB |
| `/admin/bills/new` — the bill builder |      203.9 kB |
| `/admin` — the 30-day chart           |  **196.5 kB** |

**All three named components are on admin routes, and those routes are already the lightest
in the application** — 68–75 kB below the storefront and about 90 kB under the 290 kB budget.
Dynamic-importing them would shave bytes off the pages furthest under the limit, for the one
person who ever opens them, while the storefront is untouched.

There is also **no PDF viewer to split**. A bill is served as a PDF (`/bills/{key}`) and the
browser opens it; nothing in this application renders one in the page.

And the storefront's own floor is not app code. D-035 attributes it: `next` 245 kB and
`react-dom` 55 kB before this application contributes a byte, with no unjustified dependency
to remove. The one storefront split actually attempted — deferring `sonner` behind
`next/dynamic` — measured **worse** (278.6 → 281.0 kB), because `<Toaster />` mounts in the
root layout so the lazy chunk is requested on load anyway and the wrapper is pure overhead.

So the item is marked done with the measurement recorded rather than satisfied by a split
that improves nothing. The precedent is D-035's: state the measurement, do not quietly edit
the spec — and equally, do not perform the letter of a checklist item when the measurement
says it buys nothing. If the admin bundle ever matters, the same three components are still
the candidates and the numbers above are the baseline.

---

## D-054 — staging is deferred until the first non-additive migration, and a guard takes its place

§9.8 asks for "staging mirrors production". It is not built, and this records why rather than
ticking it — the standard D-035 and D-049 set.

### The argument

Staging protects against deploying something that breaks production. Most of that protection
already exists here: **1197 unit/integration tests and 571 E2E**, all green; `pnpm build &&
pnpm start` on a laptop _is_ a production build; rollback is a documented two-minute Render
redeploy (`specs/ROLLBACK.md`); and all 10 migrations to date are additive, so the old code
runs against the new schema by construction.

**The part that settles it is what a first deploy costs.** At launch the production database
has no customers. A wrong environment variable makes `lib/env.ts` refuse to boot and name the
variable; you fix it and redeploy, and nobody was affected. Staging is insurance on a house
with nothing in it. That reverses once there are real orders — which is why the deferral has a
**trigger** rather than a date:

> **Build staging before the first non-additive migration, or before any deploy that changes
> how money is calculated.**

### What is knowingly given up

- No rehearsal of a migration against production-shaped data. Acceptable while every migration
  is additive; not acceptable for the first one that is not.
- **DEBT-009's ops half stays owed** — sending a forged `x-forwarded-for` through a real
  deployment to confirm `TRUSTED_PROXY_HOPS`. It is MEDIUM and concerns rate-limit accuracy.
- The first production deploy is also the first real deploy. Do it on a quiet morning.

### What replaces it, and why this is the better spend today

Staging protects against **bad code**. It does not protect against the failure that actually
costs a restore: a **destructive command pointed at the wrong database**. Three commands here
take their target from an environment variable and rewrite or destroy data —

| Command           | What it does to the wrong database                            |
| :---------------- | :------------------------------------------------------------ |
| `pnpm db:migrate` | `prisma migrate dev` **RESETS** on drift — drops everything   |
| `pnpm seed`       | overwrites the settings row and the admin                     |
| `pnpm test`       | the integration suites `TRUNCATE` shared tables between files |

— and nothing stopped a production URL pasted into `.env` for one debugging session from being
that target. `assertLocalDatabase()` in `lib/env.ts` now refuses unless the host is local.

**An explicit escape hatch, unlike SEC-042's guard**, which offered none. `verify-degradation`
has no legitimate remote use; these three do — seeding a fresh staging database is exactly
`pnpm seed` against a remote host. So `ALLOW_REMOTE_DB=1` exists, is named for what it does,
and must be typed on purpose. A flag you type is a decision; a permissive default is not.

`migrate deploy` is deliberately **not** wrapped: forward-only, never resets, and applying
pending migrations to a remote database is precisely its job on Render.

Each of the three refusals was tested rather than trusted, and the escape hatch was tested
too — it gets past the guard and fails on the connection instead, which is the right failure.
