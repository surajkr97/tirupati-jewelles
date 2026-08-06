# SECURITY LOG

Every finding, with severity and status. Written by the SECURITY agent.

**Severity policy:** CRITICAL blocks phase sign-off · HIGH must be fixed before the next phase
begins · MEDIUM/LOW is logged to `DEBT.md`.

| ID      | Phase | Finding                                                                                                                                                                                                                                                                                                                                                               | Severity | Status                                                                                                                                                                                                                                                                                                                                                                  |
| :------ | :---- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-001 | 1     | `server/docker-compose.yml` published Redis on `6379:6379` and Postgres on `5432:5432` to the host. Phase 1 SECURITY requires Redis not be reachable on a public port; on a laptop on shared wifi an unauthenticated Redis is remotely reachable.                                                                                                                     | HIGH     | FIXED — port publishing removed in the merged root compose; both reachable only on the compose network. Redis additionally requires a password.                                                                                                                                                                                                                         |
| SEC-002 | 1     | Committed credential: `POSTGRES_PASSWORD: fastapi123` hardcoded in `server/docker-compose.yml`, present throughout git history alongside user `fastapi_user`. Local-dev only, never a production database.                                                                                                                                                            | MEDIUM   | FIXED — **rotated**, not merely moved. Compose now reads `POSTGRES_USER` / `POSTGRES_PASSWORD` from `.env`, and `.env.example` ships a placeholder. The old pair is dead. Per Phase 1 SECURITY, history rewriting was judged unnecessary: the credential never guarded anything but a local throwaway database.                                                         |
| SEC-003 | 1     | History secret scan (`git log -p --all`) across every commit.                                                                                                                                                                                                                                                                                                         | INFO     | CLEAN — no production secret ever committed. `.env` / `.env.local` never tracked (verified by `--diff-filter=A`). Remaining matches are test fixtures (`PASSWORD = "supersecret123"` in `server/tests/test_auth.py`) and CI placeholders (`test-refresh-token-secret`, `test-secret-key` in `.github/workflows/tests.yml`) — all in deleted files, none valid anywhere. |
| SEC-004 | 3     | **`libphonenumber-js` accepts numbers that are not assigned Indian mobiles.** `isValid()` returns true for `1234567890` and `5876543210`; the bundled metadata carries no number-type data, so `getType()` is `undefined` for every Indian number and cannot be used to filter. An account on such a number can never receive an OTP and is permanently unverifiable. | MEDIUM   | FIXED — `normalisePhone` now applies the actual rule (10 digits, leading 6-9) rather than trusting the library. Both numbers are regression-tested.                                                                                                                                                                                                                     |
| SEC-005 | 3     | Rate limiter behaviour on a Redis fault. Everywhere else in the codebase Redis degrades gracefully; here that would mean unlimited OTP attempts for anyone who can pressure Redis.                                                                                                                                                                                    | INFO     | BY DESIGN — `lib/auth/rate-limit.ts` **fails closed**. Documented in D-010. Blast radius is auth and billing only.                                                                                                                                                                                                                                                      |
| SEC-006 | 3     | SMS delivery unimplemented — `SmsNotifier.send` throws. Phone OTP cannot be delivered in production.                                                                                                                                                                                                                                                                  | HIGH     | OPEN — DEBT-007. Not a vulnerability; a launch blocker. Email OTP works, so signup is unaffected.                                                                                                                                                                                                                                                                       |

---

## Phase 1 review — status

| Check                                                                       | Result                                                                                                                                                                                                                                                                 |
| :-------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git log -p \| grep -i "secret\|password\|api_key"` — no secrets in history | **PASS** — SEC-003                                                                                                                                                                                                                                                     |
| `.env` gitignored; `.env.example` has placeholders only                     | **PASS** — `git check-ignore .env` → ignored; local `.env` is mode 600 and generated with `openssl rand`. Every value in `.env.example` is a `CHANGE_ME` placeholder, and `lib/env.ts` **rejects** any secret still containing `CHANGE_ME` when `NODE_ENV=production`. |
| Seeded admin password from env, Argon2id hashed                             | **PASS** — `prisma/seed.ts` reads `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` via `lib/env.ts`; hashing goes through `lib/auth/argon2.ts` at `memoryCost 19456, timeCost 2, parallelism 1`, algorithm Argon2id. No credential is hardcoded.                             |
| Redis not exposed on a public port in docker-compose                        | **PASS** — SEC-001 fixed. `docker compose ps` confirms `127.0.0.1:6379->6379/tcp` and `127.0.0.1:5432->5432/tcp`, loopback only. Redis additionally requires a password.                                                                                               |
| `pnpm audit` — zero critical/high                                           | **PASS** — "No known vulnerabilities found".                                                                                                                                                                                                                           |

### Additional controls verified this phase (beyond the checklist)

| Control                                              | Evidence                                                                                                                                                                                                             |
| :--------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `process.env` ban is enforced, not just declared | A probe file reading `process.env.DATABASE_URL` was linted and **errored** with the `no-restricted-properties` message. A rule that never fires is worse than no rule, so it was tested rather than assumed.         |
| `@typescript-eslint/no-explicit-any` is enforced     | Same probe: `const anyVal: any` errored.                                                                                                                                                                             |
| Redis outage cannot take the site down               | Live check — `docker compose stop redis`, then `GET /` → 200 and `GET /api/health` → 200 with `redis: "down"`, `status: "ok"`. Recovered automatically on restart. Also covered by 8 unit tests against a dead port. |
| Worker runs unprivileged                             | `backend/Dockerfile` creates and switches to a non-root `worker` user.                                                                                                                                               |
| Secrets never printed                                | Local `.env` was generated in-process; no secret was echoed to the terminal or into any log.                                                                                                                         |

---

## Standing review checklist

Run every phase, per `AGENTS.md`:

- Argon2id `memoryCost: 19456, timeCost: 2, parallelism: 1` — never bcrypt defaults, never SHA
- Sessions httpOnly + Secure + SameSite=Lax, rotated on privilege change
- OTP 6 digits, hashed at rest, peppered, 5-min TTL, single-use, 6-attempt lockout, rate
  limited per identifier **and** per IP
- Admin routes checked at the edge **and** re-checked in the handler; non-admins get 404
- Every route body/query through a Zod schema — reject, don't coerce
- No raw SQL interpolation; Prisma parameterised queries only
- Uploaded filenames never used as paths — UUID them
- Price tampering: client never sends a rate; server recomputes every total
- Bill PDFs at unguessable UUIDv4 URLs, `noindex`, expiring
- Order claim only after verified OTP of that exact number
- Image URL field: https only, host allowlist, private/link-local IPs rejected,
  **re-validated after redirects**
- WhatsApp deep-link text `encodeURIComponent`'d
- IDOR: orders/bills filtered by session `userId`, never by a URL id alone
- Enumeration: unknown-user and wrong-password identical in body, status **and timing**

---

## Phase 3 review — Authentication

SECURITY reviewed this phase twice, as §3 requires — once over the design before routes
existed, once over the diff.

| Check                                                              | Result                                                                                                                                                                                                                                                                                                                                 |
| :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Argon2id parameters exactly as specified                           | **PASS** — 19456 / 2 / 1, Argon2id, in one shared module. Never re-declared per call site.                                                                                                                                                                                                                                             |
| OTP hashed at rest, peppered, single-use, TTL enforced             | **PASS** — SHA-256 over `code + OTP_PEPPER`; the digest alone is useless without the pepper, which matters because a 6-digit keyspace is 10^6 and trivially reversible otherwise. Consumption is an atomic conditional update; a concurrency test asserts exactly one of two simultaneous uses wins.                                   |
| Enumeration: identical body, status **and timing**                 | **PASS** — every login failure returns the same `GENERIC_AUTH_ERROR` with 401. The unknown-user path runs a real Argon2 verification against a decoy hash so it costs the same as a genuine check, then `padTo()` flattens the remainder. `/signup/start` and `/password/forgot` answer identically whether or not the account exists. |
| Order claim runs only after verified OTP                           | **PASS** — `claimOrdersForVerifiedPhone` is the only code path that writes `Order.userId`, and it is called from exactly one place, after `verifyOtp` returns ok. No profile-update endpoint exists that accepts a phone field.                                                                                                        |
| Session cookie flags correct in production                         | **PASS** — httpOnly always, `secure` when `NODE_ENV=production`, `sameSite: 'lax'`, `path: '/'`.                                                                                                                                                                                                                                       |
| Reset tokens single-use, invalidated on use and on password change | **PASS** — reuses the OTP mechanism (5-min TTL, stricter than the 1h the spec allows). `destroyAllSessions` on reset evicts an attacker who already holds a session.                                                                                                                                                                   |
| No user object anywhere includes `passwordHash`                    | **PASS** — `PUBLIC_USER_SELECT` is an explicit allowlist, so a column added to the schema later is invisible until deliberately added. The one query that selects it (`/login`) destructures it away before responding.                                                                                                                |
| Rate limits verified by exceeding them                             | **PASS** — limits per §3.2 (3/identifier/15min, 10/IP/hour sends; 20 verify/IP/hour), plus login limits the spec did not require but an unlimited password oracle warrants.                                                                                                                                                            |

**Additional controls beyond the checklist**

- An OTP issued for one purpose cannot validate another — asserted, since a signup code
  validating a password reset would be a full account takeover.
- Verifying a number already verified by a different account returns 409 rather than
  transferring it: the number is the claim key for purchase history.
- `proxy.ts` returns 404 (not 403, not a redirect) for `/admin`, and carries a header
  comment stating plainly that it is **not** the security boundary — the handler guard is.

---

## Phase 4 review — Rates Engine & Ticker

Reviewed the Phase 4 diff only, per AGENTS.md. Two rate values exist in this system and the
whole review turns on keeping them apart: the **true rate** in `MetalRate` → Redis, and the
**display rate** the ticker jitters. Everything with money attached must read the first.

### The phase's own checklist

| Check                                                      | Result                                                                                                                                                                                                                                     |
| :--------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/admin/rates` rejects non-admin with 404         | **PASS** — verified three ways: `requireAdmin()` re-checked in the handler (not only in `proxy.ts`), 27 assertions in `app/api/admin/rates/route.test.ts`, and a live unauthenticated POST over HTTP in `e2e/rates.spec.ts` returning 404. |
| Rate input Zod-validated: positive, bounded, integer paise | **PASS** — `z.number().positive().max(100_000_000)`, metal/purity as enums, plus a metal↔purity pairing check. 12 rejection cases asserted, each also asserting **nothing was written**.                                                   |
| Every rate change writes an `AuditLog` with actor and IP   | **PASS** — written inside the same `$transaction` as the rate row, so a rate cannot be recorded without its audit entry. `before` and `after` both captured. Asserted, including that a _rejected_ change writes no entry.                 |
| Client cannot influence the stored rate through any route  | **PASS** — see below.                                                                                                                                                                                                                      |

### Price tampering — the control that matters most in this app

MASTER-SPEC's risk table requires "Client never sends a rate. Server reads rate from DB at
request time and recomputes every total." Checked as four separate claims rather than one:

1. **No public route mutates a rate.** `/api/rates` and `/api/rates/history` export `GET`
   only; a POST to either returns 405, asserted over real HTTP.
2. **The admin route derives the stored value, never accepts it.** A body carrying
   `ratePerGram`, `setByUserId` and `role` alongside the legitimate fields is accepted, and
   all three extras are discarded — the stored row holds the server's conversion of
   `displayRupees` and `setByUserId` is the session's admin id. Asserted.
3. **The jitter has no path to a server.** `lib/ticker-jitter.ts` is a pure function; the
   value lives in one `useState` inside `RateTicker` and is passed to nothing. `lib/rates.ts`
   does not import it, and a grep confirms no other module does either.
4. **The endpoint the calculator will read returns the stored value untouched.** Asserted
   against the row in Postgres.

§4 TEST's "open the calculator and assert it uses the true rate" cannot run until Phase 5
builds the calculator. Carried into Phase 5 as a required test rather than marked done.

### Findings

**SEC-007 — MEDIUM, fixed. Unauthenticated rate-history read was unbounded.**
`GET /api/rates/history` is public and `MetalRate` is append-only, so the response size grew
with how long the shop had been trading — an admin correcting rates a few times a day for a
year is thousands of rows returned on every request. `days` was already bounded (1–365);
the row count was not. Added `MAX_HISTORY_POINTS = 500` with `orderBy: desc` + `take`, then
reversed, so the cap drops the **oldest** points rather than hiding today's rate behind last
month's. Asserted.

**SEC-008 — MEDIUM, fixed. The rate limiter denied the first request after every restart.**
Found while running Phase 4's cache tests, in Phase 1/3 code. `lib/redis.ts` combined
`lazyConnect: true` with `enableOfflineQueue: false`, so the connection only began on the
first command and that same command was rejected with "Stream isn't writeable". Because
`lib/auth/rate-limit.ts` deliberately **fails closed**, the first login attempt after every
deploy or restart was answered `429 Too many attempts. Try again later.` and then worked on
retry. Reproduced against a production build before being diagnosed.

This is a security-relevant availability defect rather than a vulnerability — the limiter
erred toward denial, which is the safe direction — but a limiter that denies legitimate
first requests trains operators to distrust it.

Fixed with a bounded `ensureReady()` gate that waits only for the _first_ connection attempt
and is settled for the life of the process afterwards. The alternative, `enableOfflineQueue:
true`, was tried and rejected: it also queues commands while Redis is genuinely down, which
measured **13.4s per call** against a dead port and would have turned "Redis is down" into
"the site is down" — the exact failure MASTER-SPEC §7 forbids. Two regression tests assert
the first `cached()` call populates the key and the first rate-limit check is allowed; both
fail against the pre-fix code, verified by checking it out and running them.

**SEC-009 — INFO. Public rate routes are not rate limited.**
`/api/rates` and `/api/rates/history` are unauthenticated GETs. Both carry
`s-maxage=300` so a CDN absorbs repeat traffic, both are read-only, and the history response
is now capped. Phase 9 §9.1 already plans a global per-IP limit in the proxy, which is the
right layer for it. Logged to DEBT.md as DEBT-012, not fixed here.

### Standing checklist — items touched by this phase

| Control                                                        | Result                                                                                                                                                                                 |
| :------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin routes checked at the edge **and** in the handler        | **PASS** — `proxy.ts` covers `/admin/*` pages; `/api/admin/rates` calls `requireAdmin()` itself and does not rely on the proxy at all.                                                 |
| Non-admins get 404, not 403                                    | **PASS** — and a signed-in customer and a stranger receive byte-identical responses. Asserted, because any difference is an oracle.                                                    |
| Authorisation is checked before input validation               | **PASS** — a malformed body from a stranger returns 404, not a 400 that would reveal the schema and confirm the route.                                                                 |
| Every route body/query through a Zod schema, reject not coerce | **PASS** — the new `days` parameter is parsed with an explicit digits-only regex rather than `z.coerce.number()`, which would turn `''` into 0 and `true` into 1. Ten rejection cases. |
| No raw SQL interpolation                                       | **PASS** — Prisma only; the new history query is fully parameterised.                                                                                                                  |
| No stack traces leak                                           | **PASS** — both new routes fail through `serverError()`, which returns a generic message under `NODE_ENV=production`.                                                                  |
| Money never crosses the wire as a JSON number                  | **PASS** — asserted on both routes. A JSON number would truncate above 2^53 and invite float arithmetic on money.                                                                      |

### Not a finding, but recorded

The ticker jitter itself remains the phase's real exposure, and it is a business risk rather
than a technical one — displaying a price you will not transact at. Mitigations are all
present and now all tested: the ±2% clamp (10,000 ticks), the permanent disclaimer (asserted
on every surface), the true rate on `/api/rates`, and the off-switch (asserted in a real
browser against a server built with the flag off). Ownership of the residual risk still sits
with the shop owner — DEBT-002, unchanged.

---

## Phase 5 review — Multi-Item Calculator

Reviewed even though `05-calculator.md` lists only DEV → TEST → DESIGN — see D-016. This
phase adds the only endpoint in the application where an unauthenticated caller can create
a database row, which is not something to leave unreviewed on a technicality.

### The control this phase exists to uphold

MASTER-SPEC's risk table, price tampering: _"Client never sends a rate. Server reads rate
from DB at request time and recomputes every total. A client-submitted total is **advisory
only** and must be discarded."_

Checked as four separate claims, each with a test that fails if it regresses:

| Claim                                                         | How it holds                                                                                                                                                                                                        |
| :------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The client cannot submit a total                              | `shareRequestSchema` is `.strict()` and has no total field, so `{"items":[...],"grandTotal":"1"}` is a **400**, not a silently ignored key. Asserted, together with "and nothing was written to the table".         |
| The client cannot submit a rate                               | Same mechanism. `POST` with a `rates` key is rejected; the endpoint reads `getCurrentRates()` itself. A share carrying its own rates would let anyone publish any price under the shop's domain.                    |
| A shared page recomputes rather than replaying a stored total | `CalculatorShare` stores items and a rate snapshot, never a figure. `/calculator/s/[slug]` runs `calculateTotal` server-side on read.                                                                               |
| The jitter cannot reach the money path                        | `lib/pricing.ts` has **zero imports** — asserted by a test that reads the file. A second test walks every file in `components/calculator/` and `lib/calculator/` and fails if any imports the ticker or its jitter. |

### Findings

**SEC-010 — MEDIUM, fixed before sign-off. Unauthenticated public write.**
`POST /api/calculator/share` is the application's only anonymous insert. As first written
it had no limit, so a loop would fill the table. Now rate limited at 20 per IP per hour
through the existing `consume()`, with a test that exhausts the limit and asserts the 21st
is refused **and** that only 20 rows exist.

Note this limiter is allowed to fail closed on a Redis fault, unlike the degrade-gracefully
rule elsewhere: losing the share button during an outage is a much smaller problem than an
unbounded public insert. That matches the Phase 3 reasoning in SEC-005.

**SEC-011 — INFO. Expired shares are never deleted, only hidden.**
`readShare` refuses anything past `expiresAt`, so an expired link is unreadable — but the
row stays. With a 30-day TTL and a 20/hour/IP cap the growth is slow and bounded, and the
`@@index([expiresAt])` exists precisely so a sweep is cheap. Logged as DEBT-015 for Phase 9
rather than adding a scheduler this phase. (`backend/celery_app/` is the eventual home;
MASTER-SPEC §2 says do not build on it yet.)

**SEC-012 — INFO. A share label is attacker-controlled text on a page under our domain.**
Anyone can create a share and choose the item labels, which then render on
`tirupatijewelles.com/calculator/s/…`. React escapes it — there is no
`dangerouslySetInnerHTML` anywhere in the codebase, verified by grep — so this is not XSS.
The residual is reputational: a link that looks like it came from the shop. Mitigations
already in place: the page is `noindex` (asserted in E2E), labels are capped at 80
characters, and the page carries no branding claim beyond the site shell. Logged as
DEBT-016; the fix if it ever matters is a moderation or ownership model, not an escape.

### Standing checklist — items this phase touches

| Control                                                        | Result                                                                                                                                                                                                   |
| :------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every route body/query through a Zod schema, reject not coerce | **PASS** — one schema serves the API _and_ the sessionStorage restore, so a hand-edited `"weightGrams":"abc"` in devtools is discarded on the same rule that rejects it over the wire.                   |
| No raw SQL interpolation                                       | **PASS** — Prisma only. The single `$queryRaw` in the codebase is `/api/health`'s `SELECT 1`, a tagged template with no interpolation.                                                                   |
| No `dangerouslySetInnerHTML`                                   | **PASS** — zero occurrences repo-wide.                                                                                                                                                                   |
| Money never a float                                            | **PASS** — `lib/pricing.ts` is `bigint` end to end and _throws_ on a `number` stone charge. The only `Number()` calls are on validated percentage and milligram text, guarded by `Number.isSafeInteger`. |
| No stack traces leak                                           | **PASS** — the share route fails through `serverError()`.                                                                                                                                                |
| Unguessable URLs for shared artefacts                          | **PASS** — ~57 bits from `crypto.randomBytes`, never `Math.random`. 1,000 draws asserted collision-free.                                                                                                 |
| Stored data re-validated on read                               | **PASS** — a corrupted `items` blob or an incomplete rate snapshot makes the share read as missing rather than rendering a wrong price. Both asserted by corrupting a real row.                          |
| Enumeration                                                    | **PASS** — expired and never-existed are the same 404.                                                                                                                                                   |

Zero CRITICAL, zero HIGH. Phase 5 is clear to sign off.

---

## Phase 6 review — Catalog & WhatsApp Enquiry

Every item on §6's SECURITY checklist, checked against a running application rather than by
reading the diff.

| Check                                                       | Result                                                                                                                                                                                                                                      |
| :---------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **IDOR:** fetch another user's order by ID → 404            | **PASS** — `/account/orders` takes no parameters at all, which is the strongest form of the guarantee: there is no id to tamper with. Asserted at the query level too, since that shape is what Phase 8's order and bill fetches must copy. |
| Bill download checks session ownership                      | **N/A this phase, flagged.** Phase 8 owns bill delivery; §6.6 only renders the link when a key exists. Recorded as an inherited obligation below.                                                                                           |
| WhatsApp text URL-encoded — tested with the §6 hostile name | **PASS** — `Ring & "Special" #1 <script>alert(1)</script>` round-trips byte-identical, and the `text=` parameter provably contains no bare `&` or `#`.                                                                                      |
| Search input parameterised                                  | **PASS** — ten injection shapes, including stacked statements and a `UNION`, return an ordinary empty result. One test drops-then-counts to prove the table is still there.                                                                 |
| Filter params validated against an allowlist                | **PASS** — every filter value is one of a fixed set of string tokens. An unknown sort is not rejected, it is _replaced_ by the default before it can reach an `orderBy`.                                                                    |
| Inactive products 404 on direct access                      | **PASS** — `isActive` is in the WHERE clause, not checked after the fetch, so no caller can forget it. Also asserted for listings, search and related products, and for a product whose _category_ was retired.                             |

### Findings

**SEC-013 — MEDIUM, fixed in design. The enquiry log would have stored a session credential.**
§6.3 asks the log to record "session". The obvious implementation stores the session id —
and that id is a credential: `session:{sid}` is the Redis key, so anyone holding it can set
the cookie and become that user. An analytics table is a low-value target that is
nonetheless widely readable, and putting session ids in it turns a minor leak into account
takeover. Stored instead as an HMAC keyed on `SESSION_SECRET`, truncated to 128 bits: it
groups a visitor's enquiries, which is the entire question the dashboard answers, and is
neither reversible nor replayable. D-017.

**SEC-014 — LOW, fixed. Public write with no limit.**
`POST /api/enquiry` is unauthenticated by necessity — it fires as an anonymous visitor
leaves for WhatsApp. Rate limited at 60/IP/hour, which is far above real use and low enough
that filling the table takes effort. It answers `204` to everything, including a malformed
body: a beacon cannot read a response, and an analytics endpoint must never surface an error
to a customer.

**SEC-015 — INFO. The image optimiser allowlist is derived from `ALLOWED_IMAGE_HOSTS`.**
`next.config.ts` builds `remotePatterns` from the same variable `lib/env.ts` parses, `https`
only and with no wildcard hostnames. This matters more than it looks: a permissive
`remotePatterns` turns Next's image optimiser into a fetch-arbitrary-URL proxy. Deriving
both the optimiser allowlist and Phase 7's SSRF check from one variable means they cannot
drift into one permitting what the other rejects.

### Additional controls verified beyond the checklist

| Control                                               | Evidence                                                                                                                                                                                  |
| :---------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target="_blank"` carries `noopener`                  | Asserted in E2E on the enquiry CTA. Without it the opened page can navigate the tab it came from.                                                                                         |
| No `dangerouslySetInnerHTML` anywhere                 | Grep, repo-wide. Product names and descriptions are admin-entered and rendered as text.                                                                                                   |
| A stale search cache cannot resurrect a product       | The cache holds IDs, and they are re-queried with `isActive: true` on every read. Asserted by deactivating and by deleting a cached product — both disappear immediately, not after 300s. |
| Search results are `noindex`                          | Asserted. Letting every `?q=` combination be crawled is how a small site acquires thousands of thin pages.                                                                                |
| Repeated query parameters are dropped, not merged     | `?purity=22k&purity=evil` yields no purity filter. Taking the first value would let a benign prefix smuggle something past a naive check.                                                 |
| `page` cannot reach Prisma as `NaN` or as a huge skip | Bounded to 1–100; anything else becomes 1. `NaN` in a `skip` throws, and an unbounded page is a free table scan.                                                                          |

### Inherited obligations recorded for Phase 8

- **Bill downloads must re-check session ownership.** §6.6 renders `/bills/{key}` when a key
  exists. An unguessable URL is not an authorised one, and MASTER-SPEC's IDOR control
  requires the fetch to be filtered by the session's `userId`, not by the key alone.
- **`normalisePhone()` before writing `customerPhone`**, still outstanding from Phase 3.

Zero CRITICAL, zero HIGH. Phase 6 is clear to sign off.

---

## Phase 7 design review — Admin Panel & Media

Run before implementation, as §7 requires ("SECURITY (design review) → DEV"). §7 calls this
"the heaviest review of the build", and the reason is §7.7: the media URL field is the one
place in the application where an authenticated user hands the server an arbitrary URL and
asks it to fetch it.

Four constraints are carried into DEV. Each changes what gets built, not merely how it is
reviewed.

### 1. The SSRF guard must connect to a VERIFIED IP, not to a hostname

§7.7 lists the controls: https only, host allowlist, reject private ranges, re-validate
after redirects, 5s timeout, 10MB cap, magic bytes. All necessary. **They are not
sufficient**, and the gap is the one that gets written up afterwards.

The standard implementation resolves the hostname, checks the address is public, and then
calls `fetch(url)`. That fetch performs its **own** DNS lookup. Between the two, an attacker
controlling the DNS record answers once with a public address and once with
`169.254.169.254` — the check passes and the fetch goes somewhere else entirely. This is DNS
rebinding, and it defeats every control in the §7.7 list because each one runs on the wrong
side of the gap.

**Constraint:** resolve once, validate the resulting address, then connect to _that address_
via a custom `lookup` on the HTTP agent, with the original hostname preserved for TLS SNI
and the `Host` header. Redirects are followed manually, one at a time, with the full check
re-run on every hop — never by the fetch layer, which would re-resolve.

### 2. There is no CSRF origin check anywhere in the application today

§7 SECURITY requires "SameSite=Lax plus an origin check" on state-changing routes. Grepping
`lib/http.ts` and `proxy.ts` finds no origin handling at all, and this is **not** a Phase 7
gap — it applies to every mutating route written since Phase 3, including
`POST /api/admin/rates`.

`SameSite=Lax` does block the cookie on a cross-site POST, so this is defence in depth
rather than an open hole. But it is one browser default away from being the only control,
and Lax has known edge cases.

**Constraint:** one shared `requireSameOrigin()` in `lib/http.ts`, applied to every mutating
handler in the application — retrofitted to the Phase 3–6 routes in this phase, not just
added to the new ones. A control applied only to code written after it was invented is a
control with a hole in the shape of the older code.

### 3. Uploads must not pass image bytes through the app server

§7.8 is explicit. This is a correctness constraint as much as a security one — buffering a
10MB upload in a route handler is how a Node process runs out of memory — but the security
half is that magic-byte validation must still happen, and the app never sees the bytes.

**Constraint:** issue a short-lived signed grant, let the browser upload directly to the
provider, and validate on the callback by fetching only the first bytes of the stored object
through the same hardened client as §7.7. The provider host is in `ALLOWED_IMAGE_HOSTS`, so
that path is already covered.

### 4. Settings changes need re-authentication, and the admin session is already short

§7 SECURITY asks for both. `ADMIN_SESSION_TTL_SECONDS` is 8h from Phase 3 — already done,
noted so it is not re-litigated.

**Constraint:** settings mutations require the admin's password again, verified server-side
against the same Argon2id parameters, with a short grace window afterwards. Settings carry
the WhatsApp number every bill is sent from and the GSTIN printed on invoices; an
unattended-laptop takeover of those is worth more than a rate change.

### Standing items reconfirmed for this phase

- Every `/admin` route and handler re-checks role independently. `proxy.ts` is not a
  boundary (§3.6) and its own header says so.
- Non-admins get 404, never 403 — including for a _malformed_ request, so the endpoint is
  not confirmed by a 400.
- Product description is a plain textarea. §7.4 already forbids a rich-text editor; the
  review agrees and notes the reason is that it is an XSS surface for no benefit, not merely
  a scope choice.
- Uploaded filenames are never path components. UUIDs only.
- Every admin mutation writes an `AuditLog` with actor and IP.

Design approved subject to the four constraints above.

---

## Phase 7 final review — Admin Panel & Media

The design review's four constraints, checked against what was built.

| Constraint (from the design review)                     | Result                                                                                                                                                                                                      |
| :------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. SSRF guard connects to a verified IP, not a hostname | **PASS** — `lib/media/fetch-image.ts` resolves once, pins the address through a `lookup` override, and follows redirects by hand. Asserted directly, and mutation-checked: removing the pin fails the test. |
| 2. CSRF origin check, retrofitted application-wide      | **PASS** — `requireSameOrigin()` on all twelve mutating routes from Phases 3–6, plus the Server Action equivalent. 11 unit assertions.                                                                      |
| 3. Uploads must not pass bytes through the app server   | **NOT DONE** — §7.8 is not built. See below.                                                                                                                                                                |
| 4. Re-authentication for settings changes               | **PASS** — the password is re-verified against the same Argon2id parameters, and the save button is disabled until one is entered. Asserted in E2E with a wrong password.                                   |

### The §7 SECURITY checklist

| Check                                                                                         | Result                                                                                                                                                                                                                                                                                                                                          |
| :-------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every `/admin` route and handler re-checks role                                               | **PASS** — the layout calls `requireAdminPage()`, and every mutation goes through `adminAction`, which calls `requireAdmin()` again. Verified live across all eight routes.                                                                                                                                                                     |
| Every admin call with a customer session → 404                                                | **PASS** — 8 actions × the customer case, all refused with the identical message a signed-out caller sees.                                                                                                                                                                                                                                      |
| Every admin call with no session → 404                                                        | **PASS** — same 8, and a separate assertion that nothing was written.                                                                                                                                                                                                                                                                           |
| SSRF suite (metadata, `file://`, `localhost:6379`, redirect to a private IP, DNS → 127.0.0.1) | **PASS** — 47 assertions, including ranges §7.7 does not list.                                                                                                                                                                                                                                                                                  |
| Magic-byte check on uploads                                                                   | **PARTIAL** — implemented and used for every pasted URL; the upload path itself is not built.                                                                                                                                                                                                                                                   |
| Reject a 100MB file before buffering                                                          | **PASS for URLs** — the 10MB cap is enforced while streaming and the socket is destroyed at the limit, so a lying `content-length` cannot get a large body into memory.                                                                                                                                                                         |
| XSS: `<img src=x onerror=alert(1)>` as a product name                                         | **PASS** — stored verbatim, escaped at render. Sanitising on write would corrupt a legitimate name and still not help, because the defence is at render: React escapes every interpolation, there is no `dangerouslySetInnerHTML` anywhere, and the WhatsApp message is `encodeURIComponent`'d. The slug is separately stripped to `[a-z0-9-]`. |
| All admin mutations write an AuditLog with actor and IP                                       | **PASS** — enforced by construction: the audit helper is part of the wrapper every mutation uses.                                                                                                                                                                                                                                               |
| Admin session shorter than customer (8h)                                                      | **PASS** — from Phase 3, unchanged.                                                                                                                                                                                                                                                                                                             |
| CSRF: SameSite=Lax plus an origin check                                                       | **PASS** — see constraint 2.                                                                                                                                                                                                                                                                                                                    |

### Findings

**SEC-016 — MEDIUM, fixed during implementation. Check order on an admin route leaked its existence.**
The CSRF retrofit initially placed `requireSameOrigin()` _before_ `requireAdmin()` on
`POST /api/admin/rates`. The origin check answers 403, so an unauthenticated cross-origin
request received 403 rather than 404 — which confirms the route exists and defeats §3.6's
rule. Authorisation now runs first and swallows every non-admin into the same 404 regardless
of origin. Asserted live and in E2E.

**SEC-017 — LOW, fixed. Origin comparison accepted a downgraded scheme.**
`Host` carries no scheme, so `http://shop.example` and a host of `shop.example` compared
equal once the default port normalised away. In production the origin must now be https.
Found by a test whose expectation was stricter than the first implementation.

**SEC-018 — INFO. Link URLs on media slots are scheme-restricted.**
A slot's link is never fetched, so it needs no SSRF check — but it is rendered as an `href`,
and `javascript:` in an href is XSS. Only a relative path or an https URL is accepted;
`javascript:`, `data:` and protocol-relative `//host` are all refused. Asserted.

### Outstanding

**§7.8 uploads are not implemented, and cannot be completed here.** Direct-to-provider
signed uploads need real credentials — `UPLOAD_PROVIDER_KEY` currently holds a placeholder,
and neither an UploadThing app id nor a Cloudinary account exists to sign against. Building
the flow blind would produce code that has never run, which is worse than an honest gap.

What that leaves open, stated plainly: the two upload-specific SECURITY cases — a `.php`
renamed `.jpg`, and a 100MB file — are unproven **for the upload path**. Both controls exist
and are tested for the pasted-URL path, which shares the same `sniffFormat` and the same
streaming cap, so the mechanism is proven; the wiring is not. Tracked as DEBT-022.

Zero CRITICAL, zero HIGH. Phase 7 is **not** signed off, on scope rather than on security.

---

## Phase 7 addendum — uploads implemented (§7.8)

Cloudinary credentials arrived after the final review, so §7.8 was built. This records what
changed and what is still unproven.

### The design

Constraint 3 of the design review — "uploads must not pass image bytes through the app
server" — holds: the server issues a signature, the browser POSTs the file to Cloudinary,
and the server is then told where it landed. Nothing large reaches this process.

**Every constraint is inside the signature.** Folder, format allowlist, 10MB cap, the
server-generated UUID public id, `image_metadata: false` and the eager transformations are
all signed, so a client that rewrites one invalidates the signature rather than relaxing the
rule. A test recomputes the signature from Cloudinary's documented rule rather than by
calling our own code, so dropping a constraint from the signed set fails.

**EXIF is stripped at ingest, not only on delivery.** Cloudinary strips metadata when
serving by default, but the _original_ retains it and originals are retrievable. §7.8's
reason is specific — "jewellery photos taken in-shop carry GPS coordinates of the owner's
premises" — so `image_metadata: false` discards it on upload and the coordinates never exist
on the provider.

**The client's report is not trusted.** `confirmUpload` checks the returned URL is on our
cloud, in our folder, and carries the public id _we_ issued — then runs the same
`checkImageUrl` guard a pasted URL gets, fetching the bytes and sniffing the magic numbers.
Cloudinary validates at ingest too; we check again, because "the provider already validated
it" is an assumption rather than an observation.

### SEC-019 — INFO. A signing trap worth recording

Cloudinary excludes `file`, `cloud_name`, `api_key` and `resource_type` from the signature,
and including one returns `Invalid Signature` with no indication which. Signing
`resource_type` made every upload fail 401 — _including the legitimate control image_, which
is what showed it was our bug rather than the controls working. Removing it changed the
response to a permissions error, separating two problems that had been masking each other.

The lesson generalises: a security probe needs a control case that must SUCCEED. Without the
real-PNG case, a blanket rejection would have looked like a perfect result.

### Outstanding

`pnpm verify:upload` runs the two §7 SECURITY upload cases against the live account. It
currently stops at the control: the API key authenticates and can read, but its role lacks
`create`, so every upload is refused 403. That is an account setting, not code.

Until the role is changed, the `.php`-renamed-`.jpg` and oversized-file rejections are
**proven for the pasted-URL path and unproven for the upload path**. The mechanism is shared
— the same `sniffFormat`, the same streaming cap — so the risk is that the wiring is wrong,
not that the controls are absent. DEBT-022.

### SEC-020 — LOW, accepted. The upload key is over-privileged, by plan limitation

Cloudinary's free tier offers exactly two API-key roles: **Master Admin** and **Media
Library User**. The latter cannot `create`, so uploads are impossible with it; the former
can manage the whole product environment, not merely write assets. There is no
least-privilege option available — **Technical Admin**, which would be the right scope, is
a paid-plan feature.

So the key is deliberately more powerful than the job requires. Accepted, with the reasons
it is tolerable stated rather than assumed:

- The secret is server-side only. It signs upload parameters in a Node process and is never
  sent to the browser, never inlined into a bundle, and never logged. `lib/env.ts` is the
  only module that reads it.
- Its blast radius is one product environment, not the Cloudinary account.
- Uploads are already constrained independently of the role: folder, format allowlist, size
  cap and public id are inside the signature, so even a caller holding a valid grant cannot
  write outside `tirupati/products` or store a non-image.

**What to do if the plan changes:** move the key to Technical Admin. Until then this is a
watch item rather than a fix. Tracked as DEBT-025.

### §7.8 verification — CLOSED

`pnpm verify:upload` passes against the live Cloudinary account. Every §7 SECURITY upload
case now has an observed result rather than an inferred one:

| Case                                                       | Result                                                                     |
| :--------------------------------------------------------- | :------------------------------------------------------------------------- |
| A real PNG — **the control**                               | `200 ACCEPTED`                                                             |
| A `.php` renamed `.jpg`                                    | `400 REJECTED` — "Raw file format jpg not allowed"                         |
| An `.html` renamed `.jpg`                                  | `400 REJECTED` — same                                                      |
| An SVG (a real image format, outside the signed allowlist) | `400 REJECTED`                                                             |
| A 12MB file, over the 10MB cap                             | `400 REJECTED` — "File size too large. Got 12582982. Maximum is 10485760." |
| Tampered params — keep EXIF, escape the folder             | `401 REJECTED` — `Invalid Signature`                                       |

Two things worth drawing out.

**The rejection message names the mechanism.** "Raw file format jpg not allowed" is
Cloudinary saying it sniffed the bytes, found a _raw_ file, and refused to store it as an
image — the extension claimed `.jpg` and the content did not agree. That is the magic-byte
check §7 SECURITY asks for, observed rather than assumed.

**The size rejection quotes both numbers.** `Got 12582982. Maximum is 10485760.` The maximum
is ours, and it arrived inside the signature. A client cannot raise it without invalidating
the signature — which the last row demonstrates directly.

The control case is the one that makes the rest meaningful: without it, a blanket rejection
would read as a perfect result. It was exactly that control failing which exposed the
`resource_type` signing bug (SEC-019).

DEBT-022 is closed. SEC-020 (the over-privileged Master Admin key) remains open as DEBT-025,
a plan limitation rather than a defect.

---

# Phase 8 — Billing → PDF → WhatsApp → Auto-Order

Status: **PASS** — zero CRITICAL, zero HIGH. One MEDIUM found and fixed before sign-off.

Phase 8 adds two things this application has not had before: a **capability URL** that an
unauthenticated stranger is meant to be able to use, and a **document generator** that renders
admin-supplied text into a file the customer keeps. Most of the review went there.

## The §8 checklist

| Requirement                                                        | Result                                                                                                           |
| :----------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| Bill PDF URL unguessable and unlisted; sequential guessing 404s    | PASS — UUIDv4 keys, and `1`, `2`, `1.pdf`, `0001` and a path traversal all 404 without touching the database     |
| Customer A cannot fetch B's bill by ID or by PDF key               | PASS — proven live and in the route suite; holding B's key is not enough without B's HMAC                        |
| Only ADMIN can create bills                                        | PASS — 404 for signed-out and for a signed-in CUSTOMER, byte-identical, and nothing written in either case       |
| Claiming requires **verified** phone ownership                     | PASS — probed directly against the database; see below                                                           |
| Customer name and note escaped in the PDF and the WhatsApp message | PASS — with a caveat about what "escaped" means in a PDF; see below                                              |
| Rate limit bill creation (20/min)                                  | PASS — the 21st request in a minute is 429 and the 20 before it are the only rows written                        |
| Every bill creation and send audited                               | PASS — `ORDER_CREATE`, `BILL_SEND`, `BILL_VOID`, `BILL_PDF_REGENERATE`, each with actor and IP                   |
| PDF has no `X-Frame-Options: ALLOWALL` or public-read bucket ACL   | PASS — `DENY`, `private, no-store`, `noindex`; the bytes are in Postgres, so there is no bucket ACL to get wrong |

## The controls that carry this phase

**Order hijack — one writer, verified by grep, not by memory.** `Order.userId` is written in
exactly two places: `createBill`, which sets it only when a user holds that phone **and**
`phoneVerified = true`, and `claimOrdersForVerifiedPhone`, whose `WHERE` includes
`userId: null` so it can never take an order somebody else already claimed. `phoneVerified:
true` is written in exactly **one** place — the claim path. That is what makes §8's
"attempt to claim by setting a phone field without OTP" fail by construction.

Probed rather than argued. A bill was raised to an unowned number; an account then took that
number the way `POST /api/auth/phone/verify` takes it (writing `phone`, leaving
`phoneVerified` false):

- the existing order stayed unclaimed,
- `phoneVerified` stayed false,
- and a bill raised **afterwards** still did not link.

**Price tampering — four separate claims, each with a test.** The request schema has no field
for a total or a rate and is `.strict()`, so sending either is a 400 rather than a silent
drop. Rates are read from the database inside `createBill`. Every stored figure comes from
`lib/pricing.ts`. And the reprint path refuses to print a bill whose stored total does not
reproduce from its own snapshot.

**Bill forgery — the key alone is not an authorisation.** `/bills/{key}` accepts a valid
unexpired HMAC signature, **or** a session that owns the order, **or** an admin session. A
correct key with neither is a 404. That closes DEBT-021 without breaking the WhatsApp
recipient, who has no account by design. The HMAC is keyed on a value derived from
`SESSION_SECRET` through a versioned domain label, so it cannot collide with the Phase 6
enquiry HMAC on the same secret; the expiry is inside the MAC, so extending it invalidates
the signature; and the comparison is `timingSafeEqual`.

**Enumeration.** Every refusal from `/bills/{key}` returns an identical body: "no such bill",
"bad signature" and "not yours" are indistinguishable from outside. Verified by comparing
the response text of all three.

**Injection.** Four `$queryRaw` sites exist in application code and all four are tagged
templates with bound parameters. The two Phase 8 adds — the invoice sequence and the
dashboard chart — interpolate only server-derived values (a year, a date). The accountant's
CSV neutralises leading `=`, `+`, `-` and `@`, which is the injection that actually matters
for a file that opens in Excel.

## SEC-021 — MEDIUM, **fixed** — an unvalidated invoice prefix could permanently break PDF delivery

`billPrefix` (§7.9) was validated for length only: `z.string().min(1).max(8)`. It flows into
`Order.orderNo`, which flows into the invoice's `Content-Disposition` header.

Probed at the runtime rather than reasoned about:

| Prefix   | Result                                                                  |
| :------- | :---------------------------------------------------------------------- |
| `JW`     | accepted                                                                |
| `A"X`    | accepted — malformed header, filename truncated at the quote by parsers |
| `A\r\nX` | **throws** — `Headers.append` rejects CR/LF in a value                  |

So it is **not** response splitting: the runtime refuses the header. What it is, is durable.
The prefix is baked into `orderNo` at creation, so every invoice raised while a bad prefix
was set would 500 on download **forever**, and the numbers cannot be changed afterwards
without editing an invoice series that GST rules require be kept intact.

Admin-only and self-inflicted, which is why it is MEDIUM rather than HIGH. Fixed rather than
logged because the consequence is permanent and the fix is two lines, both applied:

1. The settings schema restricts the prefix to `[A-Za-z0-9-]`.
2. `/bills/{key}` sanitises the filename before it reaches the header, so the route does not
   depend on that schema staying as it is.

## Findings logged, not fixed

**SEC-022 (INFO) — the WhatsApp link is a bearer capability for seven days.** That is the
design (§8.3), not a defect: the recipient has no account, so possession of the link is the
only proof available. It does mean anyone with access to the customer's WhatsApp can open
the invoice until it expires. Mitigated by the 7-day window and by the link being useless
after it. Worth stating plainly because it is the one place this application deliberately
authorises on possession alone.

**SEC-023 (INFO) — database backups now contain invoices.** D-026 puts the rendered PDF
bytes in Postgres, so a backup that was previously catalogue data plus hashed credentials now
also contains customer names, phone numbers and purchase histories in a directly readable
document format. Nothing is wrong with the storage; what changes is the handling requirement
for the dumps. Phase 9's deployment work should treat backups as containing personal data —
encryption at rest and a retention limit — and it is logged as DEBT-031 so that is not
discovered during an incident.

**SEC-024 (INFO) — the signed URL is cached in Redis.** `bill:{key}` holds the absolute URL
including its signature for 24h (§8.3 asks for exactly this). Redis is loopback-only and
password-protected since SEC-001, so the exposure is the same as the session store's. Noted
because the cache now holds capabilities rather than only derived data.

**SEC-025 (INFO) — the invoice logo is fetched during bill creation.** It goes through Phase
7 §7.7's pinned-IP guard unchanged, so the SSRF controls hold. The new consideration is
availability, not confidentiality: a slow third-party CDN sits inside the shop's most
important action. Bounded by a 5s timeout, a six-hour Redis cache of the bytes, and a
fallback to a typographic wordmark on any failure — a bill never fails to generate because a
logo would not load.

## What "escaped in the PDF" actually means

§8 SECURITY asks for the customer name and note to be "escaped in the PDF". The phrase
imports an HTML mental model that does not apply: `@react-pdf/renderer` hex-encodes every
string into the content stream, so there is no markup to break out of and no injection to
escape. Saying "PASS — React escapes it" would be answering a different question.

The real hazard in this renderer is the opposite one, and it is silent: a character the font
cannot encode is not an error, it is a **wrong glyph**. A customer named "Priya & Sons 🙏"
printed as "Priya & Sons =O" on a live render. On a tax invoice the customer's name is the
field a dispute turns on, so `lib/bills/pdf-text.ts` now removes what cannot be drawn and
transliterates what has a plain equivalent, with a visible placeholder when a name reduces to
nothing. That is the control the checklist item is really asking for.

The WhatsApp message is a different matter and does need encoding — it is user-influenced
text in a URL parameter. It goes through Phase 6's single `encodeURIComponent` call,
round-trip asserted with a name containing `&` and an emoji, in the unit suite and again in a
real browser.

## Dependencies

`pnpm audit` — no known vulnerabilities. One runtime dependency added,
`@react-pdf/renderer` 4.5.1, named by §8.3 and noted in the phase file. It runs server-side
only and nothing from it reaches the browser bundle.

---

# Phase 9 (early) — the claim token, DEBT-011

Status: **PASS** — zero CRITICAL, zero HIGH. The design this review specified in Phase 8 was
built as specified, with one deliberate departure recorded below.

## Against the five constraints set in the Phase 8 review

| Constraint                                     | Where it lives                                                                        | Proven by                                        |
| :--------------------------------------------- | :------------------------------------------------------------------------------------ | :----------------------------------------------- |
| Single use, enforced in **Postgres** not Redis | `consumeClaimToken`'s conditional `UPDATE … WHERE consumedAt IS NULL AND expiresAt >` | five concurrent consumes; exactly one wins       |
| Short TTL                                      | 7 days, matching the signed PDF link in the same message                              | asserted, and the window measured on a real row  |
| Rate limited per number **and** per IP         | `CLAIM_LIMITS`, both consumed on every attempt                                        | a guessing run is cut off at five                |
| Unguessable                                    | 256-bit HMAC, base64url                                                               | shape and length asserted                        |
| Not derivable from the invoice number          | `orderNo` is not an input; the key never leaves the server                            | two bills to one number produce unrelated tokens |

Stored hashed and peppered, exactly like `OtpCode` — asserted directly: the stored value is a
SHA-256 digest and is not the token.

## SEC-026 (INFO, accepted) — the bill message now carries two capabilities

It already carried one: the signed PDF link. It now carries a second with a wider blast
radius — the PDF is one invoice, the claim token is every unclaimed purchase on that number.

Accepted, because the alternative is the feature not existing. The bounding controls are the
ones above, plus two properties worth stating:

- The token is bound to **one number**. Holding it lets you claim that number's purchases and
  nothing else, and a test asserts a token minted for a different number leaves the other
  order untouched.
- Claiming requires a **session**. The token says who holds the number; the account says where
  the purchases go. Possession of the message alone changes nothing until someone signs in,
  which is also what makes the action attributable — `consumedBy` records who redeemed it and
  an `ORDER_CLAIM` audit entry records the result.

Anyone with access to the customer's WhatsApp already has the invoice. What they gain is the
customer's other purchases to that number, for seven days, once, from an account they must
create and sign into.

## SEC-027 (INFO) — the derived token trades a property for stability

D-031 records this in full. A random token would be worthless to an attacker holding the
environment; this one can be minted by someone who holds `SESSION_SECRET` **and** knows an
order id **and** its phone number. Accepted: that secret leaking already forges every session
in the system, the extra values are not public, and single use, the TTL and the rate limits
are unaffected. Flagged here rather than buried in a decision file because it is the one place
this feature is weaker than the obvious implementation.

## What was checked and found correct

**The GET does not consume.** A single-use credential in a URL that a link preview, a browser
prefetch or the customer forwarding the message to themselves would burn. `/claim/[token]`
peeks; only `POST /api/auth/claim` redeems. Asserted five consecutive peeks leave
`consumedAt` null, and mutation-checked by making the page consume — the E2E fails.

**The consume and the claim are one transaction.** A token spent on a claim that then failed
would be gone, and the customer's only copy is a WhatsApp message they cannot re-trigger.

**No enumeration.** Invalid, expired and already-used all return the same message from both
the page and the API. The one exception is deliberate and reveals nothing about the token: a
visitor whose **own account** already has a verified number sees "you're all set" instead —
a fact about them, not about the credential.

**Every refusal leaves the data alone.** Each denial case in the route suite re-reads
`Order.userId` and `User.phoneVerified` and asserts both unchanged. A route that answers 400
and still claims is the failure a status-code assertion would not see.

**The collision rule is explicit** (D-032): an unverified holder of the number is detached, a
verified one is not and the claim is refused. Both asserted.

**Origin, session and audit.** CSRF origin check, `requireUser`, `ORDER_CLAIM` audit entry,
and `rotateSession` on success — the account has gone from unverified to holding a proven
number and a purchase history, which is the privilege change §3.3 requires rotation for.
