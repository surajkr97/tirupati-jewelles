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
