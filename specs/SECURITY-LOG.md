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

SEC-007 through SEC-027 are recorded in their own phase sections below, where the reasoning
sits next to the control it concerns. The table above was not backfilled past Phase 3; the
Phase 9 findings are indexed here because §9.1's scope is the whole application rather than
one diff.

### Phase 9 §9.1 — whole-application pass

| ID      | Finding                                                                                                                                                                     | Severity | Status                                                                                                                                                                                                               |
| :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-028 | The CSRF origin check exists twice and had drifted: SEC-017's downgraded-`http://` fix reached `lib/http.ts` only, so every admin Server Action (D-024) still accepted one. | MEDIUM   | **FIXED** in this review — one shared `checkSameOrigin()`; regression test mutation-checked.                                                                                                                         |
| SEC-029 | **The runtime database role is a Postgres superuser** (`rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolbypassrls`) and owns all 17 tables. §9.1 requires no DDL at runtime. | **HIGH** | **FIXED** — the app now runs as `tirupati_app`: DML only, no DDL, and no `DELETE` on the invoice tables. Proven by refusal, and 120 E2E green against it. DEBT-035 closed; DEBT-026 is now enforced by the database. |
| SEC-030 | CSP, HSTS and `Permissions-Policy` absent on every response. Measured on six routes against a production build.                                                             | MEDIUM   | OPEN — §9.1 item 1, DEV. Design constraints recorded (nonce CSP would disable ISR).                                                                                                                                  |
| SEC-031 | No log redaction, and PII demonstrably reaches log lines — a Prisma error serialises its arguments, so `serverError` prints a customer's email and phone verbatim.          | MEDIUM   | OPEN — DEBT-036. Same control as §9.4's Sentry PII scrubbing.                                                                                                                                                        |
| SEC-032 | `clientIp()` takes the leftmost `x-forwarded-for` entry, which the client controls. Every per-IP limit in the application is keyed on it.                                   | MEDIUM   | OPEN — narrows DEBT-009. Code fix + one ops confirmation.                                                                                                                                                            |
| SEC-033 | `parseBillFilters` accepts an impossible date (`9999-99-99` passes its regex) → `Invalid Date` → Prisma throws → 500 on `/admin/bills` and the CSV export. Probed live.     | LOW      | OPEN — DEBT-037. Admin-authenticated, discloses nothing.                                                                                                                                                             |
| SEC-034 | No global per-IP rate limit.                                                                                                                                                | INFO     | OPEN — DEBT-012, §9.1 item 2. Must fail **open**, unlike the auth limiter.                                                                                                                                           |
| SEC-035 | Dependabot not enabled. `pnpm audit` is clean today; nothing watches for tomorrow.                                                                                          | INFO     | OPEN — §9.1 item 4, DEV.                                                                                                                                                                                             |

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

---

# Phase 9 §9.1 — the whole-application security pass

Status: **FAIL for the phase checklist** — zero CRITICAL, **one HIGH open**, four MEDIUM.
One MEDIUM found and fixed during the review.

This is the first review in the project whose scope is the application rather than a diff, so
its method is different: every claim below was measured against a **production build served on
`next start`**, or probed against the running Postgres, rather than read off the source. Where
a control was already reviewed in its own phase it was re-confirmed here, not re-argued.

Six of the ten §9.1 items pass. The four that do not are all **build work for DEV**, and
`SIGNOFF.md` already assigns §9.1's implementation to DEV — so this review's job is the
verdict, the findings, and the design constraints below. The one item SECURITY owns outright,
the OWASP Top 10 review, is at the end of this section.

## The §9.1 checklist

| #   | Item                                                  | Verdict        | Evidence                                                                                                                                                          |
| :-- | :---------------------------------------------------- | :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Headers in `next.config.ts`                           | **FAIL**       | 3 of 6 present. CSP, HSTS and `Permissions-Policy` absent on every response — measured on `/`, `/rates`, `/login`, `/admin`, `/api/rates`, `/api/health`. SEC-030 |
| 2   | Global per-IP rate limiting in the proxy              | **FAIL**       | Not built. Per-route limiters exist and are good; there is no outer wall. SEC-034, DEBT-012                                                                       |
| 3   | Every API route Zod-validated, enforced by a test     | **PARTIAL**    | 18 of 20 route files validate through Zod; the other 2 validate by hand and one of them has a defect because of it (SEC-033). No enumeration test yet             |
| 4   | `pnpm audit` clean; Dependabot enabled                | **PARTIAL**    | `pnpm audit`: "No known vulnerabilities found". `.github/` has `workflows/` only — no `dependabot.yml`. SEC-035                                                   |
| 5   | Secrets rotated before launch; none ever committed    | **PASS**       | `.env` untracked at every commit; `.env.example` is placeholders (11 × `CHANGE_ME`) plus non-secret defaults. History re-scanned — see below                      |
| 6   | DB user has least privilege — no DDL at runtime       | **PASS**       | Was a **Postgres superuser**; now a DML-only role that cannot create tables or delete invoices. SEC-029, fixed                                                    |
| 7   | Redis password-protected, not publicly bound          | **PASS** (dev) | `127.0.0.1:6379->6379/tcp` and `--requirepass`. Production is a managed instance and needs one ops confirmation — see "Carried to deployment"                     |
| 8   | Error responses leak no stack traces in production    | **PASS**       | Verified by forcing real 500s, not by reading the code. Four surfaces, DB stopped mid-flight                                                                      |
| 9   | Structured logging, phone numbers and emails redacted | **FAIL**       | No structured logging and no redaction. Not theoretical — measured a Prisma error echoing a customer's email and phone. SEC-031                                   |
| 10  | Full OWASP Top 10 review documented here              | **PASS**       | Below                                                                                                                                                             |

## SEC-029 — HIGH, **fixed**. The application connected to Postgres as a superuser

The single most serious finding in the pass, and the only HIGH.

```
rolname   rolsuper rolcreaterole rolcreatedb rolbypassrls
tirupati  t        t             t           t
```

It also owns all 17 tables in `public` and holds `CREATE` on both the database and the schema.
§9.1 requires "DB user has least privilege — no DDL rights at runtime", and this is the
opposite of that in every respect the flag list has.

**Why it is HIGH rather than MEDIUM, given there is no known injection.** The finding is not
"there is a way in"; it is that the blast radius of any future way in is unbounded. Today the
application has exactly one hand-written SQL surface (`lib/catalog/search.ts`), it is
parameterised through Prisma's tagged template, and Phase 6 reviewed it. But a superuser
connection converts _any_ injection from a data-disclosure bug into `DROP TABLE`, into reading
`pg_authid`'s password hashes, and — because `COPY … FROM PROGRAM` is superuser-only —
into command execution on the database host. Least privilege is the control that makes the
severity of the _next_ bug survivable, which is exactly why it is on the launch checklist.

It also quietly undermines a control the project has already committed to. **DEBT-026**
requires six-year invoice retention and notes it is "enforced by convention, not by the
schema". A runtime role with no `DELETE` on `Order` / `OrderItem` / `BillPdf` would make that
a database guarantee instead of a promise. The two items should be fixed together.

### Fixed — and the restriction was proven by refusal, not by reading grants

Two roles now. `MIGRATE_DATABASE_URL` carries the owner and is used by `prisma migrate`
through the datasource's `directUrl`; `DATABASE_URL` carries `tirupati_app`, which the
running application uses and which can do row-level work and nothing else. The whole grant
set is `scripts/db-roles.sql`, idempotent and re-runnable, so this is reproducible on
production rather than a manual change that exists only on one laptop.

Verified by attempting the things it must refuse:

```
app role INSERT on "Product"   -> t
app role CREATE TABLE          -> ERROR: permission denied for schema public
app role DELETE FROM "Order"   -> ERROR: permission denied for table Order
prisma migrate status          -> Database schema is up to date!
```

The third line is **DEBT-026 closed structurally**. Six-year GST invoice retention was
"enforced by convention, not by the schema"; the application can no longer delete an invoice
even if a future cleanup sweep tries.

**The suite that validates this is the E2E one, not the unit one.** `vitest.setup.ts` points
at `TEST_DATABASE_URL`, which is the owner role on a throwaway database — so 863 passing
unit/integration tests say nothing about the restriction. Playwright starts `pnpm dev`, which
reads `DATABASE_URL`, so it is the only suite exercising the restricted connection. **120 E2E
tests pass against it**, including the flagship bill-to-claim journey (which inserts an
`Order`, its `OrderItem`s and a `BillPdf`), the admin CRUD screens that do delete rows, and
the CSV export. Nothing was over-revoked.

Two operational notes for deployment, both discovered by hitting them:

- `prisma generate` resolves **both** URLs, and `pnpm build` runs generate first — so
  `MIGRATE_DATABASE_URL` must be set at build time on the platform, not only at migration
  time. A missing value fails the build, not the migration.
- Tests must keep the owner role: they `TRUNCATE` between files, and TRUNCATE requires table
  ownership rather than a grantable privilege.

## SEC-030 — MEDIUM, open. CSP, HSTS and Permissions-Policy are absent

Measured against `next start`, not read from config. Every response carries `nosniff`,
`X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin` — the three
Phase 1 set — and nothing else.

The design constraint that goes with this is the one worth reading, because it changes what
DEV should build. It is in "Constraints for DEV" below.

## SEC-031 — MEDIUM, open. A Prisma error prints the customer's email and phone

§9.1 asks for "structured logging with phone numbers and emails **redacted**". There is
neither structure nor redaction: logging is `console.error` in eleven places plus Prisma's own
output.

This was probed rather than assumed, because the interesting question is whether PII can
actually reach a log line. It can, by the shortest possible path:

```
--- error echoes email: true
--- error echoes phone: true
          email: "victim.person@example.com",
          phone: "+919812345678",
```

A Prisma validation error serialises the **whole argument object** into its message.
`serverError(err, context)` in `lib/http.ts` passes that error straight to `console.error`, so
any route whose input reaches Prisma in a shape Prisma rejects prints the customer's email and
phone verbatim into production stdout — which on the deployment target is a dashboard, is
retained, and is often shipped onward to a log aggregator.

A second, narrower path: `lib/auth/rate-limit.ts:80` logs `rule.key` on a Redis fault, and the
key embeds the identifier by construction (`otp:send:id:user@example.com`,
`login:id:+919876543210`). Every fail-closed event writes one.

This is the same class as **DEBT-031** (backups now hold invoices): the data did not change,
the set of places it lands did, and the handling rules were written when those places held
nothing sensitive.

## SEC-032 — MEDIUM, open. Every per-IP limit is keyed on an attacker-controlled value

DEBT-009 raised this in Phase 3 and assigned it here. Confirming it: `clientIp()` takes the
**leftmost** `x-forwarded-for` entry, which is the one a client can set. Behind a proxy that
appends rather than replaces, `X-Forwarded-For: 1.2.3.4` makes every request look like it came
from a different address of the caller's choosing.

What rides on that value is the whole per-IP layer: OTP send and verify, login, the claim
token, calculator shares, enquiries, bill creation — and, if it is built as specified, the
§9.1 global limit too. Per-identifier limits are unaffected, which is what keeps this MEDIUM
rather than HIGH: credential guessing against one account is still bounded.

DEBT-009 said "confirm the deployment topology". That is the right instruction and it cannot
be answered from inside the repository, but the code can stop _depending_ on the answer being
favourable. Constraint in "Constraints for DEV".

## SEC-033 — LOW, open. An impossible date 500s the bills list and the CSV export

`parseBillFilters` validates dates with `/^\d{4}-\d{2}-\d{2}$/`, which accepts `9999-99-99`.
That becomes `new Date(...)` → `Invalid Date` → Prisma. Probed against the real database:

```
from=9999-99-99  : THROWS -> PrismaClientValidationError:
                   Invalid value for argument `gte`: Provided Date object is invalid.
page=99999999999 : OK (no throw)
control          : OK
```

So `/admin/bills?from=9999-99-99` and `/admin/bills/export?from=9999-99-99` both 500. The
function's own comment says "a hand-edited URL cannot 500"; it can. LOW because it is behind
`requireAdmin`, discloses nothing, and the admin is doing it to themselves.

Recorded at all because of _where_ it is. `/admin/bills/export` is one of the two route files
with no Zod schema, and this is precisely the failure the §9.1 requirement exists to prevent —
a hand-rolled parser that looks like validation and has a gap in it. The second suspected
defect in the same function, an unbounded `page` overflowing Prisma's `skip`, **does not
exist**: it was probed and does not throw. Both are stated because a review that reports only
its confirmed suspicions is not reporting its method.

## SEC-034 — INFO. No global rate limit (DEBT-012 remains open)

Unchanged from Phase 4's assessment: the public rate routes are read-only, capped, and
`s-maxage=300`, so the exposure is request volume rather than data. The correct layer is still
the proxy. Constraints below, including the one that stops it taking the site down.

## SEC-035 — INFO. Dependabot is not enabled

`pnpm audit` is clean today. `.github/` contains `workflows/tests.yml` and nothing else, so
nothing watches for the next advisory. §9.1 asks for it explicitly.

## SEC-028 — MEDIUM, **fixed in this review**. The CSRF check existed twice and had drifted

The only finding this review fixed directly, because it was a live regression in a control
this log itself introduced.

Phase 7 added the origin check in two places, for a real reason: a route handler needs a
`NextResponse` and a Server Action cannot return one. Phase 7 then recorded, in a comment on
the second copy, that "the logic is identical and both are tested".

Both halves of that sentence were false. **SEC-017** — reject a downgraded `http://` origin in
production, because `Host` carries no scheme and `http://shop.example` compares equal to a
host of `shop.example` once the default port normalises away — was applied to `lib/http.ts`
only. `lib/admin/actions.ts` still compared hosts alone. And the test coverage matched the
code rather than the claim: `lib/http.test.ts` has "rejects a downgraded http origin in
production"; `lib/admin/admin.test.ts` tests a wrong _host_ and never a downgraded _scheme_.

The reason this matters more than the usual duplicated-logic complaint is **D-024**: every
admin mutation in this application is a Server Action. So the copy that kept the bug was the
one guarding the rate editor, the product editor, settings, and the bill actions — and the
copy that got the fix guards two JSON endpoints. SEC-017 was recorded as fixed while remaining
open everywhere it mattered most.

Fixed by making the decision exist once: `checkSameOrigin()` in `lib/http.ts` returns a verdict
(`ok` / `absent` / `malformed` / `mismatch`) and both shapes are thin wrappers over it. The
`absent` case is preserved deliberately and is not a hole — no `Origin` header means a
server-to-server caller, and CSRF requires a browser with an ambient cookie, which always
sends one.

**Mutation-checked.** `lib/admin/actions.csrf.test.ts` was run against the pre-fix
implementation and fails on exactly the case that was missing:

```
× refuses http:// when the host matches, in production
  AssertionError: expected true to be false
  Tests  1 failed | 3 passed
```

and passes against the fix. The test asserts the mutation **did not run**, not merely that the
result was `ok: false` — a check that returned an error while still writing would pass a
status-shaped assertion. A positive control (https from the same host runs), the development
localhost case, and the wrong-host case are asserted alongside, so a check that refused
everything would not look identical to a correct one.

`@TEST:` this file is a security regression test written by SECURITY because the fix needed
one; it is yours to own from here. 863 unit/integration tests pass (up from 859), `pnpm lint`,
`pnpm format:check`, `tsc --noEmit` and `pnpm build` all clean.

## What was re-confirmed and found correct

Checked against the running production build, not re-argued from earlier phases.

**Error responses leak nothing (§9.1 item 8).** Verified by causing real 500s rather than by
reading `serverError`. With Postgres stopped mid-flight, `/bills/{uuid}` — which has no
try/catch around its query — returned `500` with an **empty body**; `/search?q=gold` returned
500 with no leak markers; `/api/health` returned a clean `503`; and `/` still returned **200**
from the ISR cache. Bodies were grepped for `at …(`, `node_modules`, `prisma`, absolute paths
and `ECONNREFUSED`: zero matches. The stack traces went to stdout, which is correct, and is
what makes SEC-031 the finding it is.

**No secret has ever been committed.** `.env` and `.env.*` are gitignored with an
`!.env.example` exception; `git ls-files` shows only `.env.example` tracked. A history scan
across all commits for assignment-shaped secrets returned test fixtures, obviously-fake values
and code identifiers only — no live credential. Consistent with SEC-003.

**Injection surface is where Phase 6 left it.** Application `$queryRaw` use is three sites:
`lib/catalog/search.ts` (reviewed in Phase 6, every user value a `${}` bound parameter),
`lib/bills/numbering.ts` (the atomic sequence), and `app/admin/page.tsx` (the 30-day chart) —
plus `SELECT 1` in the health check. No `$queryRawUnsafe` anywhere, no string-built SQL.

**No XSS primitives.** Zero `dangerouslySetInnerHTML` in `app/`, `components/` or `lib/`. No
`eval` or `new Function`. Every one of the six `target="_blank"` links carries
`rel="noopener noreferrer"` — checked individually, not by sampling.

**`process.env` is still confined to `lib/env.ts`.** The Phase 1 lint rule holds: the only
other occurrences in the repository are in test files and `*.config.ts`, both exempt by design.

**CSV injection is handled.** `csvField` prefixes a tab to any value starting `= + - @` before
quoting, so an admin-entered customer name cannot become a formula in the accountant's
spreadsheet. Worth noting because the export is the one place application data lands in a
program that executes its input.

**Access control is unchanged and correct.** `requireAdmin()` in every admin route handler and
`adminAction`; 404 rather than 403 throughout; authorisation checked before input validation so
a malformed body cannot elicit a 400 that confirms a route exists; `/bills/{key}` still refuses
a bare key. `PUBLIC_USER_SELECT` is an allowlist, so `passwordHash` cannot reappear in a
response by someone adding a column.

## Two stale comments that matter

Both assert a Next.js limitation that **Next 16 does not have**, and both are load-bearing —
they are the stated reason a control lives somewhere other than where it belongs.

`proxy.ts:20` and `lib/auth/guard.ts:8` say the proxy "runs at the edge and cannot reach Redis
or Prisma". Per `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`:

> Proxy defaults to using the Node.js runtime. The `runtime` config option is not available in
> Proxy files.
> …
> | `v16.0.0` | Middleware is deprecated and renamed to Proxy. Proxy defaults to the Node.js runtime |

So the global Redis-backed limiter §9.1 asks for **can** live in the proxy. The comments are a
Next 14/15 fact carried into a Next 16 file — exactly what `AGENTS.md`'s version notice warns
about.

The conclusion those comments support is still correct for a different reason, and must not be
weakened: `proxy.ts` is **not** a security boundary, because a matcher is one typo away from
exempting a route and because Server Actions are POSTs to the page's own route (documented in
the same file) — so a matcher change silently removes coverage. Re-check in the handler. Fix
the reasoning, keep the rule.

## Constraints for DEV — read before building §9.1

Four constraints. Two of them change what gets built, in the way the Phase 7 design review's
did.

### 1. Do **not** use a nonce-based CSP. It would silently destroy ISR.

This is the constraint most likely to be got wrong, because the nonce recipe is the first thing
Next's own CSP guide shows and it is the right answer for most applications. It is the wrong
answer here, and the failure is not loud.

Next's guide is explicit about the cost:

> When you use nonces in your CSP, **all pages must be dynamically rendered**. … Static
> optimization and Incremental Static Regeneration (ISR) are disabled.

This application is built on ISR — `/` at 300s, `/rates` at 300s, `/collections`,
`/products/[slug]` and `/policies/[slug]` at 600s, several with `generateStaticParams`. It is
serving from that cache right now; measured on the production build:

```
/       200  x-nextjs-cache: HIT   Cache-Control: s-maxage=300, stale-while-revalidate=…
/rates  200  x-nextjs-cache: HIT
```

§9.2 sets LCP < 2.0s and TTFB < 400ms on throttled 4G and asks DEV to "verify ISR is actually
serving cached HTML — check the `x-nextjs-cache: HIT` header". A nonce CSP turns every one of
those HITs into a full server render. §9.1 would be met and §9.2 would become unreachable, and
nothing would fail — the site would just get slower.

The second half is worse, and is why "just be careful" is not a plan. A nonce written into a
**cached** page is a fixed string, while the header sent with each request is fresh — so every
request after the first serves HTML whose nonce does not match, and the browser blocks every
script. The page renders and does not hydrate. If DEV sets the CSP on the _request_ headers
(which is how Next learns the nonce) for a route that is statically rendered or ISR-cached,
that is what happens.

Verified against the built output rather than reasoned about: a prerendered page contains
**4 inline `<script>` tags** carrying the RSC flight payload, with no nonce and no `integrity`
attribute. `script-src 'self'` alone blocks them and the page will not hydrate.

Experimental SRI does not rescue this. In `next/dist/server/app-render/required-scripts.js`
the SRI manifest is applied to external bootstrap and preinit scripts **by `src`**; the inline
data stream is nonce-only. Integrity attributes cannot cover an inline script.

**So: `script-src 'self' 'unsafe-inline'`, and document why — which §9.1 already anticipates by
requiring the `unsafe-inline` justification in writing.** `'unsafe-eval'` must be absent, as
§9.1 requires, and it genuinely is not needed in production.

That concession is smaller here than it looks, and the reason should be recorded next to it:
`unsafe-inline` matters when an attacker can get markup into a page, and this application has
no `dangerouslySetInnerHTML`, no `eval`, no HTML-bearing user content, and React escaping
everywhere — checked above. CSP is defence in depth against a future mistake, not a control
holding a known gap shut.

**If a strict `script-src` is wanted anyway**, the way to get it without paying for it is a
second, tighter policy on the surfaces that are _already_ `force-dynamic` — `/admin/*`,
`/account/*`, `/claim/*` — where a nonce costs nothing because nothing is cached, and where
the value is highest. Two rules if that path is taken: emit exactly **one** CSP header per
response (two headers are enforced as an intersection and will produce confusing breakage), and
never set the CSP on the _request_ headers for a cacheable route. Optional; the baseline policy
is the requirement.

The rest of item 1 is uncontroversial: `Strict-Transport-Security:
max-age=63072000; includeSubDomains; preload`, `Permissions-Policy` denying camera, microphone
and geolocation, and the three already present. `frame-ancestors 'none'` belongs in the CSP
alongside the existing `X-Frame-Options: DENY` — the header is the legacy control, the
directive is the one modern browsers enforce. `img-src` must permit the `ALLOWED_IMAGE_HOSTS`
entries or every product photo disappears.

### 2. The global limiter must fail **open**. This inverts the existing rule, on purpose.

`lib/auth/rate-limit.ts` fails **closed**, and Phase 3 was right: a limiter that fails open
hands unlimited OTP attempts to anyone who can pressure Redis. **Do not copy that behaviour to
the global limit.**

A global fail-closed limiter means a Redis outage returns 429 for every request to every page —
it converts "Redis is down" into "the site is down". That directly contradicts MASTER-SPEC §7,
§9.5's "Redis down → slower, functional", and Phase 1 TEST's verified degradation, which this
review re-confirmed still holds (`/` served 200 with Postgres stopped).

The two limiters are different kinds of control and should fail in different directions:

| Limiter              | Protects against    | On a Redis fault                                 |
| :------------------- | :------------------ | :----------------------------------------------- |
| Per-route (Phase 3)  | credential guessing | **closed** — deny. Losing it is a vulnerability  |
| Global per-IP (§9.1) | flooding            | **open** — allow. Losing it is a lost mitigation |

State it in the module, because the next person to read the two files will otherwise "fix" the
inconsistency.

Three sizing notes for the same file. **Exclude RSC prefetches** (`next-router-prefetch` /
`purpose: prefetch`) — `next/link` fires one per link, so a catalogue page can generate dozens
of proxy-visible requests per navigation and a limit tuned for humans will lock out browsing.
**Be generous on the default tier**: a large share of this shop's customers reach it through
carrier CGNAT, where one address is thousands of people, so a tight per-IP page limit blocks a
neighbourhood rather than an attacker. And **give `/api/health` headroom** — §9.4 puts uptime
checks on it, and a monitor that gets a 429 reports a false outage.

### 3. Make the client IP trustworthy, or make the limits honest about not being (SEC-032)

Taking the leftmost `x-forwarded-for` entry trusts the client. Taking the **rightmost** trusts
the nearest proxy, which is the spoof-resistant choice, and it is correct both for a platform
that replaces the header and for one that appends.

It has one catastrophic failure mode that must be designed out rather than hoped away: if the
hop count is wrong, the derived address is the load balancer's, every visitor lands in one
bucket, and the global limiter locks out the entire site. So make the number of trusted hops
**explicit configuration**, and add the guard that makes a misconfiguration self-correcting —
if the selected entry is private, loopback or link-local, it is an infrastructure address, so
fall back to the rightmost public entry rather than using it as an identity.

Then confirm the topology, which is the part DEBT-009 actually asked for and the part that
cannot be done from the repository: send a request with a forged `X-Forwarded-For` through the
real deployment and log what arrives. Keep DEBT-009 open until that has been run against
production infrastructure.

### 4. The enumeration test must assert behaviour, not an import (§9.1 item 3)

§9.1's own words: "a checklist item decays, a test does not." A test that greps route files for
a schema import decays the same way — it passes on a file that imports a schema and forgets to
apply it, and it fails on `/bills/[key]`, which validates its key with a strict UUIDv4 regex and
is _correct_.

Two of twenty route files do not use Zod today, and they are different cases:

- `/bills/[key]` — a strict UUIDv4 regex, reject-not-coerce, malformed keys never reach the
  database. Substantively compliant.
- `/admin/bills/export` — a hand-rolled allowlist parser, and the one with SEC-033 in it.

The honest test drives each route with a malformed input and asserts a **4xx and no write** —
which is what "reject, don't coerce" means. An allowlist is a fine way to satisfy it; the test
should care that bad input is refused, not which library refused it. Whatever shape is chosen,
mutation-check it: widen one schema and confirm the test fails, or it is asserting nothing.

---

# OWASP Top 10 (2021) — full application review

§9.1 item 10. Every row states where the control lives and what proves it. "Verified" means
measured in this pass or asserted by a test that has been mutation-checked in an earlier one.

## A01 — Broken Access Control · **PASS**

The application's strongest area, and the one with the most history behind it.

- Every admin route handler and every Server Action calls `requireAdmin()`; `proxy.ts` is
  documented as not being the boundary and the handler re-checks. Non-admins get **404**, never
  403, so the route's existence is not confirmed — and authorisation runs **before** input
  validation, so a malformed body cannot elicit a 400 that leaks the same fact (SEC-016).
- IDOR: `/account/orders` takes no parameters at all — there is no id to tamper with.
  `/account/orders/[id]` and `/bills/{key}` filter by the session's `userId`. `/bills/{key}`
  refuses a correct key carrying nothing else (DEBT-021), accepting only a valid HMAC
  signature, session ownership, or admin — with a byte-identical 404 for every refusal.
- `/admin/bills/export` is a route handler under `/admin` and therefore gets **no layout**, so
  `requireAdminPage()` never runs for it. It calls `requireAdmin()` itself. This is the exact
  shape of bug that "the proxy is not a boundary" exists to catch, and it was caught.
- Vertical escalation is bounded by session rotation on privilege change (§3.3) and an 8h admin
  TTL.

Nothing new this pass.

## A02 — Cryptographic Failures · **PASS**

- Passwords: Argon2id, `memoryCost 19456 / timeCost 2 / parallelism 1`, one shared module.
- OTP: hashed and peppered at rest, 5-minute TTL, single-use by conditional `UPDATE` in
  Postgres, 6-attempt lockout. Claim tokens follow the same pattern.
- Sessions: 32 random bytes base64url (256 bits, not a UUID's 122), opaque, server-side,
  revocable. Cookie `httpOnly`, `SameSite=Lax`, `Secure` in production.
- Bill URLs: HMAC-SHA256 compared with `timingSafeEqual` on equal-length buffers.
- Enquiry logging stores an HMAC fingerprint rather than the session id (SEC-013) — the
  difference between an analytics row and a session-hijacking kit.

One gap, and it is transport rather than cryptography: **HSTS is absent** (SEC-030). `Secure`
cookies mean the session cannot be sent in clear, but the first request to `http://` still
happens without it. `Strict-Transport-Security` with `preload` is what closes that, and it is
already on §9.1's list.

## A03 — Injection · **PASS**

- No `$queryRawUnsafe`; three `$queryRaw` sites, all parameterised via tagged template.
  `websearch_to_tsquery` rather than `to_tsquery` in search, so a typo like `gold &` is a
  no-result query rather than a 500 (Phase 6).
- 18 of 20 route files parse input through Zod; the other two validate by hand, one correctly
  (`/bills/[key]`) and one with SEC-033 in it.
- XSS: no `dangerouslySetInnerHTML`, no `eval`, no `new Function`, React escaping throughout,
  `rel="noopener noreferrer"` on all six `target="_blank"` links. Media link URLs are
  scheme-restricted so `javascript:` cannot reach an `href` (SEC-018).
- Header injection: `Content-Disposition` filenames sanitised at the header, independently of
  the schema that also restricts them (SEC-021).
- CSV formula injection: neutralised in `csvField`.
- PDF: not an escaping problem but an encoding one — `lib/bills/pdf-text.ts` prevents a
  character the font cannot draw from silently printing as the wrong glyph on an invoice.

CSP would be the defence-in-depth layer here and is absent (SEC-030).

## A04 — Insecure Design · **PASS**

The category the project's process is aimed at. Price tampering is the app-specific risk and is
answered structurally rather than by validation: the client cannot submit a rate or a total, the
server recomputes every line from the database at request time, a submitted total is **rejected**
rather than ignored, and the ticker's jitter is a pure function with no import path into any
server module. `Order.userId` has exactly two writers and `phoneVerified: true` exactly one.

Design reviews preceded implementation for both new authentication surfaces (Phase 7's admin
panel, Phase 9's claim token), and in both cases the review changed what was built.

## A05 — Security Misconfiguration · **PASS** (re-rated, Phase 9 §9.1 final)

~~FAIL~~ at the first pass, when all four open findings landed here. Re-rated after
re-measuring every item against a production build on `next start` rather than re-reading the
diff:

| Item                | Verified                                                                                                                   |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------- |
| Security headers    | **6 of 6** on `/`, `/rates`, `/api/rates`, a 404, the proxy-rewritten `/admin`, and `/bills/{key}`                         |
| `unsafe-eval`       | absent from the policy entirely                                                                                            |
| HSTS                | `max-age=63072000; includeSubDomains; preload` — exactly §9.1's string                                                     |
| Global rate limit   | 60 allowed / 10 refused from one address; a second address unaffected                                                      |
| Rate-limit bypasses | **closed** — `purpose: prefetch` now yields the same 60/10, `/api/health` 600/100                                          |
| DB least privilege  | runtime role is not a superuser; CREATE, DROP, DELETE on `Order`/`BillPdf` and `pg_authid` all refused, SELECT still works |
| Redis               | `127.0.0.1:6379` only; unauthenticated `PING` → `NOAUTH`                                                                   |
| `pnpm audit`        | no known vulnerabilities                                                                                                   |
| Secrets             | zero tracked `.env` files                                                                                                  |

The original text of the failing pass follows, kept because the fix is only legible against
what was wrong.

| Item                                  | State                                                        |
| :------------------------------------ | :----------------------------------------------------------- |
| Security headers                      | 3 of 6 — SEC-030                                             |
| Database privileges                   | **fixed** — DML-only runtime role, no DDL (SEC-029)          |
| Global rate limiting                  | absent — SEC-034                                             |
| Dependabot                            | not enabled — SEC-035                                        |
| Stack traces in production            | correctly suppressed — verified                              |
| `/__design` gallery blocked in prod   | rewritten to a 404, verified in Phase 2 against a real build |
| Redis bound to loopback, password-set | verified in dev; production needs one ops confirmation       |
| `.env` never committed                | verified across all commits                                  |

## A06 — Vulnerable and Outdated Components · **PARTIAL**

`pnpm audit`: "No known vulnerabilities found". Dependencies are current and pinned or
caret-ranged; Next 16.3.0, React 19.2.8, Prisma 6.19.3, Zod 4.4.3. `onlyBuiltDependencies`
restricts which packages may run install scripts, which is a supply-chain control worth having
by default.

No automated watch (SEC-035). A clean audit is a fact about today.

## A07 — Identification and Authentication Failures · **PASS**

- Enumeration: one shared `GENERIC_AUTH_ERROR` constant for unknown-identifier and
  wrong-password, a dummy Argon2 verification on the unknown-user path, and `padTo()` flattening
  total response time. Body, status and timing all match.
- Rate limits per identifier **and** per IP on OTP send, OTP verify, login and claim. Failing
  closed — correct at this layer, and see constraint 2 for why the global one must not.
- Session fixation: `createSession` issues a fresh id on login; `rotateSession` drops every
  existing session on privilege change. Logout deletes the Redis key, not just the cookie.
- Password policy is length and guessability, no composition rules (§3.1's reasoning).

One caveat that is a product decision rather than a defect: **possession of a phone number is
proven by a WhatsApp-delivered claim token, not by SMS OTP** (D-011, D-031). Reviewed and
accepted under SEC-026/SEC-027.

## A08 — Software and Data Integrity Failures · **PASS**

- `pnpm-lock.yaml` committed; `packageManager` pinned to an exact pnpm version.
- No CDN-loaded scripts — nothing to tamper with in transit, which is also why
  `script-src 'self'` plus inline is a narrower concession than it would be elsewhere.
- Invoice integrity: bills recompute server-side, snapshot their rates per item, and the
  invoice sequence is a single atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` proven
  gapless under fifty concurrent writers. Void is a soft stamp; there is no hard delete.
- Signed direct-to-provider uploads: the Cloudinary secret signs server-side and never reaches
  the browser (Phase 7 §7.8).

SEC-029's fix strengthens this category directly: six-year invoice retention (DEBT-026) was a
convention and is now a database guarantee — the application's role has no `DELETE` on
`Order`, `OrderItem` or `BillPdf`, verified by refusal.

## A09 — Security Logging and Monitoring Failures · **PARTIAL** (re-rated, Phase 9 §9.1 final)

~~FAIL~~ at the first pass. **Logging is now closed; monitoring is not, and the category name
has two halves — so this cannot be a PASS yet, and marking it one would be the kind of tick
this phase has spent its time undoing.**

**Closed.** `lib/log.ts` emits structured JSON in production and redacts in both environments.
Verified at the emitter rather than on the pure function — the distinction that mattered,
since SEC-031 was a missing call site, not a broken algorithm. The measured Prisma error comes
back without the customer's email or phone and still names the failing call. The rate limiter's
fail-closed line no longer prints the identifier its key embeds. Error responses leak nothing:
re-verified by stopping Postgres and reading the real 500 bodies — zero stack frames, no
`node_modules`, no absolute paths, no `ECONNREFUSED`; `/` continued to serve 200 from ISR
throughout.

Also closed here, and worth naming because it cut the other way: the redactor was destroying
invoice numbers (**SEC-038**). A log that cannot be correlated fails the _logging_ half just as
surely as one that leaks.

**Still open — this is §9.4, not §9.1.** No Sentry, no uptime checks, no alerting. §9.4 also
requires "PII scrubbing configured **before** launch", which `redact()` is already exported to
serve, so the two must not grow separate ideas of what a phone number looks like. **A09 should
be re-rated to PASS only when §9.4 lands.**

The original text of the failing pass follows.

**Working:** `AuditLog` records actor, action, entity, before/after and IP for every admin
mutation, and `adminAction` makes the audited path the easy path — nothing writes to `AuditLog`
outside it. Rate-limit fail-closed events are logged. `/admin/audit` is read-only by
construction.

**Not working:** no structured logging, no redaction, and PII demonstrably reaching log lines
(SEC-031). There is no correlation id, so the four log lines belonging to one failed request
cannot be tied together. Alerting is §9.4 and is not built — including the one alert that is a
business incident rather than a technical one, "rates not updated in 24h".

`@DEV:` when Sentry lands (§9.4), the PII scrubbing §9.4 requires configured "**before** launch"
and the redaction SEC-031 asks for are the same control. Build the redactor once and give it to
both, or the two will disagree about what a phone number looks like.

## A10 — Server-Side Request Forgery · **PASS**

The strongest single control in the codebase, and the one that most deserved its design review.

`lib/media/ssrf.ts` resolves the hostname **once**, checks the resolved address against
private, loopback, link-local and CGNAT ranges, and then connects to the **pinned IP** rather
than re-resolving. That defeats the DNS-rebinding attack the obvious "resolve, check, then
`fetch()`" shape is wide open to — where the check gets a public answer and the connection gets
`169.254.169.254`. Redirects are followed by hand with the same check re-applied at every hop.
47 assertions, including the redirect case.

`next.config.ts`'s `remotePatterns` is derived from the same `ALLOWED_IMAGE_HOSTS` the guard
uses, `https` only and no wildcards, so the image optimiser and the admin URL field cannot
drift into one permitting a host the other rejects (SEC-015).

Two other outbound fetches exist and both are bounded: the bill logo fetch (SEC-025, fails
soft) and Resend's HTTPS API.

## Summary

| Category                      | Verdict  |
| :---------------------------- | :------- |
| A01 Broken Access Control     | PASS     |
| A02 Cryptographic Failures    | PASS     |
| A03 Injection                 | PASS     |
| A04 Insecure Design           | PASS     |
| A05 Security Misconfiguration | **FAIL** |
| A06 Vulnerable Components     | PARTIAL  |
| A07 Auth Failures             | PASS     |
| A08 Integrity Failures        | PASS     |
| A09 Logging & Monitoring      | **FAIL** |
| A10 SSRF                      | PASS     |

Both failures are configuration and instrumentation rather than application logic, which is
consistent with where the project has spent its attention. Neither is difficult; both are on
§9.1's checklist already.

## Carried to deployment — not answerable from the repository

Three items that need the real infrastructure and must be confirmed before launch:

1. **Redis in production** — password-protected and not publicly bound. Verified for the local
   compose stack; the managed instance needs its TLS and credential configuration confirmed
   (§9.1 item 7).
2. **The `x-forwarded-for` topology** — SEC-032 / DEBT-009. Send a forged header through the
   real deployment and log what arrives.
3. **Secret rotation before launch** (§9.1 item 5) — no secret has ever been committed, but the
   development values in `.env` must not become the production ones. `lib/env.ts` already
   refuses a `CHANGE_ME` placeholder under `NODE_ENV=production`, which catches an unfilled
   variable but not a reused development one.

Backups are a fourth, already tracked: **DEBT-031** — they now contain customer invoices and
must be encrypted at rest with a retention period that reconciles with DEBT-026's six years.

---

# Phase 9 §9.1 — DEV implementation

Status: **all ten §9.1 items now pass.** Built against the constraints the SECURITY pass set
above; every claim below was measured against a production build on `next start` or against a
running Redis, not read off the source.

## The four open items, closed

### SEC-030 — the header set

All six now present. Verified on a production build rather than in config:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://res.cloudinary.com
  https://utfs.io; font-src 'self' data:; connect-src 'self' https://api.cloudinary.com;
  object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
  upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(),
  interest-cohort=()
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
x-nextjs-cache: HIT          ← the point of D-033
```

No `unsafe-eval` in production. `unsafe-inline` on `script-src` is the documented concession
(D-033) — and the `x-nextjs-cache: HIT` on that same response is the evidence for why: a nonce
would have turned it into a full render.

`connect-src` is the directive that would have broken a feature silently. Phase 7 §7.8's
upload POSTs image bytes from the **browser** straight to Cloudinary, so omitting
`https://api.cloudinary.com` would have blocked every upload with a console violation and no
server-side error.

### SEC-034 / DEBT-012 — the global limiter

`lib/security/global-limit.ts` plus four lines in `proxy.ts`. Three tiers — auth 60/min, bill
60/min, everything else 600/min — keyed per IP in Redis.

**It fails open, and that is the whole design.** Measured both directions:

```
75 requests to /login from one address  →  60 × 200, 15 × 429
a different address, same moment        →  200          (per-IP, not global)
Redis stopped, 100 requests to /login   →  100 × 200    (fails OPEN)
Redis stopped, /  /rates  /collections  →  200, 200, 200
```

That last pair is the requirement. A fail-closed global limiter would have turned a Redis
outage into a site outage, contradicting §9.5 and Phase 1 TEST's verified degradation. The
per-route auth limiters still fail **closed**, unchanged — the two behaviours are opposite on
purpose and the module says so at the top, because the next person to read both files will
otherwise "fix" the inconsistency.

Prefetches are excluded (`next/link` fires one per link, so a catalogue page would exhaust a
human-tuned limit while someone scrolls) and so is `/api/health`, because §9.4 monitors it and
a 429 there reports a false outage.

Sizing note recorded for whoever tunes these: much of this shop's audience reaches it over
carrier-grade NAT, where one public address is thousands of people. A per-IP limit tuned for a
single browser blocks a neighbourhood.

### SEC-031 / DEBT-036 — redacted structured logging

`lib/log.ts`. JSON in production, human-readable in development, redacting in **both** — a
redactor only exercised in production is one nobody notices is broken.

The measured case that raised the finding is now a test: a Prisma error carrying
`email: "victim.person@example.com"` and `phone: "+919812345678"` comes back with neither,
while still containing `prisma.user.findMany` — a redactor that destroys the diagnostic has
traded one problem for another. Secret-_named_ keys (`password`, `token`, `cookie`, …) are
dropped whole, because a password does not have to look like anything.

The four call sites that could carry PII now route through it: `serverError`, the rate
limiter's fail-closed line (its keys embed the identifier by construction), the enquiry
handler and `adminAction`.

`@DEV:` when §9.4 adds Sentry, give `redact()` to its `beforeSend` rather than writing a
second idea of what a phone number looks like.

### SEC-035 — Dependabot

`.github/dependabot.yml`, weekly, covering npm, the Celery worker's pip requirements, its
Docker base image, and the GitHub Actions themselves — a pinned action with a known
vulnerability is a supply-chain hole in CI, which holds repository credentials. Next/React and
Prisma are grouped, because they are version-locked here and separate PRs could not pass CI
alone.

## SEC-032 — the code half is done; the ops half is not

`clientIpFromHeaders` now counts back from the **right** of `x-forwarded-for`, with
`TRUSTED_PROXY_HOPS` making the trust boundary explicit configuration rather than a hidden
assumption.

The failure mode was designed out rather than hoped away: if the hop count does not match
reality the selected entry is a load balancer's own address, every visitor collapses into one
bucket, and the global limiter locks out the whole site — worse than the problem being fixed.
So an address in a private, loopback, link-local or CGNAT range is never accepted as an
identity; it falls back to the rightmost public entry, which is correct under any hop count.

**DEBT-009 stays open.** The remaining half cannot be done from inside the repository: send a
request with a forged `X-Forwarded-For` through the real deployment and log what arrives. Note
that the local limiter test above _did_ honour a client-supplied header — correctly, because
with no proxy in front the caller's header is the whole list. That is precisely the topology
question DEBT-009 asks.

## SEC-033 — fixed, and the test that would have caught it now exists

`parseBillFilters` round-trips each date through `Date` and compares the formatted result, so
`9999-99-99` and `2026-02-30` are both refused. `page` is bounded too.

The quieter half of this bug is worth recording: `new Date('2026-02-30')` does not throw, it
returns 2 March. An admin filtering "to 30 February" would have seen March's bills with no
indication anything was wrong.

## A test that could not fail, found by mutation

`test/route-validation.test.ts` implements §9.1 item 3, and its first version was worthless
for the case that motivated it.

It drives `/admin/bills/export` with `from=9999-99-99` and passed — **and passed against the
broken parser too.** Mutation-checked by reverting the SEC-033 fix: all 21 tests stayed green.
`requireAdmin()` runs before validation (deliberately, SEC-016), so with no session the route
answers 404 and the malformed input never reaches a parser. **A route whose authorisation sits
in front of its validation cannot have its validation tested through the route.**

So the parser is tested where it lives — `lib/bills/query.test.ts`, which had no predecessor,
which is how the defect survived Phase 8. Six of its cases fail against the pre-fix parser.
The limitation is written into the route test's header so the next person does not read a
green row as evidence an admin route validates anything.

This is the third time in this project a test has been found asserting nothing (Phase 4's
reduced-motion emulation, Phase 8's PDF geometry, now this). The pattern is the same each
time: the assertion was true for a reason unrelated to the behaviour under test.

## Verification

| Check                         | Result                                                                   |
| :---------------------------- | :----------------------------------------------------------------------- |
| `pnpm test`                   | **919 passed** (up from 863) across 35 files                             |
| `pnpm exec playwright test`   | **326 passed, 32 skipped** — unchanged from baseline; no limiter lockout |
| `pnpm build`                  | clean                                                                    |
| `pnpm lint` / `format:check`  | clean                                                                    |
| `tsc --noEmit`                | clean                                                                    |
| Headers on a production build | all six present, `x-nextjs-cache: HIT` intact                            |
| Limiter denies                | 60 allowed / 15 denied, per-IP                                           |
| Limiter fails open            | 100 × 200 with Redis stopped; site browsable                             |

**A measurement error worth recording**, because it nearly produced a false finding. The first
header probe reported all three new headers missing. The cause was not the config: a
`next start` from earlier in the session still held port 3210, so the new server had exited
with `EADDRINUSE` and the probe hit **pre-change code**. Evaluating `next.config.ts` directly
showed all six headers, which is what prompted checking the process list. A probe that hits the
wrong server looks exactly like a feature that does not work.

## The §9.1 checklist, restated

| #   | Item                                      | Verdict                                          |
| :-- | :---------------------------------------- | :----------------------------------------------- |
| 1   | Headers in `next.config.ts`               | **PASS**                                         |
| 2   | Global per-IP rate limiting in the proxy  | **PASS**                                         |
| 3   | Every route validated, enforced by a test | **PASS**                                         |
| 4   | `pnpm audit` clean; Dependabot enabled    | **PASS**                                         |
| 5   | No secret ever committed                  | **PASS**                                         |
| 6   | DB least privilege — no DDL at runtime    | **PASS**                                         |
| 7   | Redis password-protected, not public      | **PASS** (dev; one ops confirmation outstanding) |
| 8   | No stack traces in production             | **PASS**                                         |
| 9   | Structured logging, PII redacted          | **PASS**                                         |
| 10  | OWASP Top 10 documented                   | **PASS**                                         |

A05 and A09 — the two OWASP categories that failed the review — are the two this work
addressed. Both should be re-rated by the closing SECURITY pass rather than by the agent that
wrote the code.

---

# Phase 9 §9.1 — final review

Findings SEC-036 to SEC-039. Every claim below was re-measured against a production build on
`next start`, or probed against the running Postgres and Redis — not read off a diff, and not
taken from the notes of the pass that made the changes.

**Independence caveat, stated rather than buried.** This block was written by the same agent
that made the fixes it reviews, which is exactly the arrangement `AGENTS.md` separates roles to
avoid. What that limits is the _rating_, not the evidence: the measurements are reproducible
commands whose outputs are quoted, and the regression tests were each confirmed to fail against
the pre-fix code. Read the numbers, not the verdict.

## SEC-036 · HIGH · fixed — the §7.7 URL guard rejected every URL, including valid ones

`checkImageUrl()` returned `unreachable — "Invalid IP address: undefined"` for **every** input.
Five call sites depended on it, so every route by which an image can enter this application was
dead: pasting a URL into a media slot, the slot preview validator, pasting a URL onto a product,
`confirmUpload` after a **successful** Cloudinary upload, and the invoice logo — which fails
soft, so bills printed without a logo and nothing reported it.

**Root cause.** `net.connect` invokes a custom `lookup` hook with `{ all: true }` and reads
`addresses[0].address`; the hook answered with the three-argument `(err, address, family)` form,
so that read was `undefined`.

**Why 47 SSRF assertions missed it.** Every one is a _rejection_. The suite's "against real
servers" block runs an **http** server, so the scheme check returns before anything connects and
`requestPinned` — the function that performs the fetch — was never once executed successfully.
The single test that touches the hook calls it as `lookup('example.com', {}, cb)`: the one
options shape `net.connect` never uses. It asserted the branch Node does not take.

Rated HIGH rather than MEDIUM because it silently disabled a control's entire positive path in a
signed-off phase, and because the failure mode of the invoice logo is invisible by design.

**Verified after the fix**, both directions:

```
ACCEPT                     https://res.cloudinary.com/…/tirupati/products/41cf480f-…
reject  host_not_allowed   https://images.pexels.com/photos/29038003/…
reject  host_not_allowed   https://res.cloudinary.com.attacker.test/x.jpg
reject  scheme_not_https   http://169.254.169.254/latest/meta-data/
reject  scheme_not_https   file:///etc/passwd
```

The allowlist was not widened to achieve the first line, and the pinning property is unchanged:
both callback shapes return only the single already-validated address, so the DNS-rebinding gap
the module exists to close stays closed.

**@TEST: §7.7's positive path still has no automated test.** Three unit tests now pin the
`lookup` contract, which is where the defect was, but nothing asserts end-to-end that a
legitimate https URL is fetched and sniffed. That needs an https test server, and until it
exists this control's success path is proven only by the manual probe above.

## SEC-037 · MEDIUM · fixed — the global rate limit was opt-out by request header

`shouldSkip()` removed a request from the limiter entirely when it carried
`next-router-prefetch`, `purpose: prefetch` or `x-purpose: prefetch`, or when the path was
`/api/health`. None is a capability; any client can set a header. Measured before the fix, over
real HTTP against a production build:

```
150 requests to /login carrying `purpose: prefetch`  ->  150 x 200   (tier is 60)
  5 from the same address WITHOUT the header         ->    5 x 200   (budget untouched)
700 requests to /api/health from one address         ->  700 x 200
```

The second line is the proof: the budget was intact afterwards, so those 150 were never counted.
`/api/health` matters more than it looks — it runs a Postgres query and a Redis ping per hit, so
an uncounted path there is a connection-pool exhaustion primitive aimed at both dependencies
§9.5 is about.

MEDIUM, not HIGH: the per-route limiters inside the handlers fail closed and remain the actual
credential-guessing control, so what was lost is flood mitigation rather than protection.

**Fixed by replacing exemption with isolation** — prefetches count in their own bucket at the
same tier limit, `/api/health` has its own tier. Re-measured after the fix, independently:

```
/login x70 from one address                    ->  60 x 200, 10 x 429
/login x70 carrying `purpose: prefetch`        ->  60 x 200, 10 x 429
/api/health x700 from one address              -> 600 x 200, 100 x 429
a different address, same moment               ->       200
```

A monitor is isolated rather than exempt: an address already refused on `/login` still receives
200 on `/api/health`, so co-located traffic cannot starve §9.4's uptime check into a false
outage. The 429 body says only `Too many requests` — no tier, no budget, no `x-ratelimit-*`.

## SEC-038 · LOW · fixed — the log redactor destroyed invoice numbers

The phone pattern carried no boundary assertion, so it matched a digit run beginning inside
another token: `order JW-2026-00042 failed` became `order JW-[phone:…042] failed`. ISO
timestamps and BIS numbers likewise.

Not a leak — the failure is toward safety — but item 9 asks for _structured logging_ with PII
redacted, and the invoice number is the primary key of every support conversation this shop will
have, on a legally numbered six-year-retained series (DEBT-026). A log nobody can correlate
fails the first half of that requirement. Fixed with lookarounds; every phone spelling the suite
asserts is still redacted.

## SEC-039 · MEDIUM · fixed — SEC-032 reached one of two client-IP implementations

`lib/admin/actions.ts` kept a private `clientIp()` taking `split(',')[0]` — the leftmost
`x-forwarded-for` entry, which is whatever the caller sent. Not used for rate limiting, so not a
limiter bypass; it is the value stamped on **every `AuditLog` row**. §7 SECURITY requires "all
admin mutations write an AuditLog with actor and IP", §7.3 displays it as rate-change history,
and §7.10 makes the log read-only precisely so it can be relied on afterwards. It recorded
`1.2.3.4` from a forged header, and `not-an-ip-at-all` just as willingly.

**This is the third time this one file has held a duplicated decision** — SEC-017 missed a copy
of the origin check, SEC-028 fixed that copy without looking nine lines up, and SEC-032 then
missed this one. The pattern is not carelessness; it is that the file re-implements what
`lib/http.ts` exports. Both decisions are now single-sourced, and `TRUSTED_PROXY_HOPS` finally
configures the whole application rather than half of it — which matters when DEBT-009's ops
confirmation is finally run.

## The §9.1 checklist, re-measured

| #   | Item                                         | Verdict     | Evidence                                                                         |
| :-- | :------------------------------------------- | :---------- | :------------------------------------------------------------------------------- |
| 1   | Headers in `next.config.ts`                  | **PASS**    | 6 of 6 on six response shapes incl. a 404 and a proxy-made 429; no `unsafe-eval` |
| 2   | Global per-IP rate limit in the proxy        | **PASS**    | 60/10 per address; both bypasses closed and re-measured. SEC-037                 |
| 3   | Every API route Zod-validated + enumeration  | **PASS**    | Proven past the auth boundary, and across all 18 Server Actions                  |
| 4   | `pnpm audit` clean; Dependabot               | **PASS**    | "No known vulnerabilities found"; four ecosystems configured                     |
| 5   | Secrets rotated; none ever committed         | **PARTIAL** | Zero tracked `.env` files. **`SEED_ADMIN_PASSWORD` is pending rotation**         |
| 6   | DB user least privilege — no DDL at runtime  | **PASS**    | Not a superuser; DDL, `DELETE` on retained tables and `pg_authid` refused        |
| 7   | Redis password-protected, not publicly bound | **PASS**    | `127.0.0.1:6379`; unauthenticated `PING` → `NOAUTH`. Production still owed       |
| 8   | No stack traces in production                | **PASS**    | Postgres stopped, real 500s read: zero frames, no paths. `/` stayed 200          |
| 9   | Structured logging, PII redacted             | **PASS**    | Asserted at the emitter, not the pure function. SEC-038                          |
| 10  | OWASP Top 10 documented                      | **PASS**    | All ten; A05 **PASS**, A09 **PARTIAL** pending §9.4                              |

## Verdict

**Zero CRITICAL. Zero HIGH outstanding** — SEC-036 was HIGH and is fixed. Nine of ten items
pass; item 5 is PARTIAL on one operational action that cannot be done from inside the
repository.

Two things travel forward and neither is a §9.1 defect:

- **`SEED_ADMIN_PASSWORD` must be rotated before launch.** It was exposed in a working
  transcript. The stored hash is Argon2id and the database is unaffected; the `.env` value is
  the exposure. §9.1 item 5 requires rotation before launch regardless.
- **DEBT-009's ops half.** `TRUSTED_PROXY_HOPS` is verified against synthetic headers only.
  Send a forged `x-forwarded-for` through the real deployment and log what arrives.

## SEC-040 · HIGH · fixed — the password-reset endpoint was an account-existence oracle over phone numbers

Found by Phase 9 §9.5's degradation run, not by review, and it had been live since Phase 3.

`/api/auth/password/forgot` chose its delivery channel from the shape of the identifier:
`Channel.EMAIL` for an email, `Channel.SMS` for a phone number. There is no SMS provider
(D-011) and `SmsNotifier.send` throws by design, "so nothing silently succeeds at sending an
SMS that never arrives". The throw was caught by `serverError` and answered **500**.

The send only executes on the branch where the user was **found**. So:

| identifier                | response |
| :------------------------ | :------- |
| registered phone number   | **500**  |
| unregistered phone number | 200      |

Which is precisely what the route is built not to do. §3 and AGENTS.md's risk table both
require the identical answer either way — the route pads its timing to 400ms and returns the
same generic body specifically to avoid being "an unauthenticated account-existence oracle over
the entire customer list" — and this made it one, keyed on phone number, for anyone willing to
POST a list of Indian mobile numbers. Indian mobile numbers are ten digits with a leading 6-9,
which is a small enough space to walk.

**Why it survived four phases of review.** The property was asserted at the level everyone
looked at — one response shape, one padded timing, one code path — and broken one level below,
in a dependency that only fails when it is called, on a branch nothing had ever called. Phase 3
TEST covered the flow end to end at the integration level with the notifier mocked; a mock does
not throw.

**Fixed** (D-052): delivery goes to the account's email whatever the customer typed, matching
`/api/auth/phone/start`, which has always done this. The OTP stays keyed on the identifier
given, so the code still verifies what the customer typed.

**And the second half, which is the security-relevant one:** a delivery failure is now caught,
logged and does **not** change the response. This deliberately departs from the codebase's
"let it throw" rule because here the response is the control. Any exception escaping delivery
re-opens the oracle at exactly the moment the provider is unhealthy — a Resend outage, an
expired key, a throttled sender — and that is a fault an attacker can wait for rather than
cause. The error is logged redacted (DEBT-036) and reaches Sentry; only the customer-visible
answer is held constant.

Regression coverage: `app/api/auth/password/forgot/route.test.ts`, 5 tests, 3 failing against
the pre-fix route. The two that pass against it do so because `@/lib/notify` is mocked — which
is the finding, restated: a unit test with the failing dependency stubbed out cannot see a fault
whose nature is that the dependency is unavailable. `pnpm verify:degradation` is what catches
this class, and it now asserts both halves against a running server.

---

# Phase 9 — SECURITY (§9.2–§9.7, the sections after §9.1's sign-off)

§9.1 was reviewed and signed off separately (SEC-029..039). This covers everything since:
the performance work, the queue, monitoring, reliability, SEO and accessibility. Two findings,
both LOW, both fixed here rather than logged — they are three-line changes and leaving them
open would have cost more to track than to close.

## SEC-040 · HIGH · fixed — recorded above, under §9.5

The password-reset account-existence oracle. Listed here because it is the phase's most
serious finding and it was found by §9.5's degradation run rather than by this review.

## SEC-041 · LOW · fixed — `/api/health` told a stranger how the shop was doing

The endpoint §9.4 built answers four alert conditions in one unauthenticated response. Three
of the four `detail` strings are specifics rather than statuses:

- `last set 81h ago` — how long since the shop touched its gold rate
- `cleanup.expire_shares has 143 waiting` — internal queue names and depth
- `4 in the dead-letter set` — that jobs are failing

None is catastrophic and all of it was public. Fixed by returning `detail` only to an ADMIN
session; the per-check `status` fields stay public because §9.4's whole design is that one
external uptime rule can watch all four, and DEBT-047's registered check reads exactly those.

**The sharper edge is deliberately NOT fixed, and the trade is recorded rather than made
quietly.** `checks.redis.status` remains public, and the global rate limiter
(`lib/security/global-limit.ts`) **fails open** — so `redis: down` announces the window in
which per-IP limits are not being enforced, turning "retry and hope" into "poll and pounce".
Three things argue for leaving it: it is the field §9.4's alert exists for, the same fact is
inferable by observing that limits stopped applying, and the owner has now registered a check
against it (DEBT-047). A concrete good against a weak, inferable signal. If this shop ever
becomes a target worth polling, the answer is an authenticated checker, not a coarser body.

Regression: two E2E cases in `e2e/smoke.spec.ts` — anonymous gets statuses and no `detail`,
an admin still gets `detail`. Both halves, because "no detail for anybody" would pass the
first while removing what whoever is on call actually needs.

## SEC-042 · LOW · fixed — the degradation script's "do not point this at production" was a comment

`scripts/verify-degradation.mts` stops Postgres and Redis. Its header has carried
"⚠ DEVELOPMENT ONLY. It stops your database. Never point it at production" since it was
written, and that is precisely the class of guardrail Phase 1 SECURITY refused to take on
trust: _"a rule that silently fails to fire is worse than no rule."_ One
`VERIFY_ORIGIN=https://…` in the wrong shell and the checklist takes the shop offline while
measuring how gracefully it degrades. `scripts/verify-bill.mts` has the same shape — prose
only — and it consumes invoice numbers that §8.2's counter cannot give back (noted, not
changed here).

Now two independent runtime conditions: the target must be loopback **and** `NODE_ENV` must
not be `production`. No `--i-know` escape hatch — there is no legitimate reason to run this
against a live shop, and an escape hatch is how one gets used.

**Tested rather than trusted, and the test found a defect in the fix.** The guard was first
placed inside `main()`, which runs _after_ the module's top-level imports — and `lib/redis.ts`
opens a socket at import time. So the refusal path had already connected to the thing it was
refusing to touch, then returned without reaching the `finally` that disconnects: it printed
the refusal and **hung**. Moved above the imports. Both conditions now verified to refuse, to
exit immediately, and to leave every container running.

## What was checked and found correct

| Area                                   | Result                                                                              |
| :------------------------------------- | :---------------------------------------------------------------------------------- |
| Job payloads across the queue boundary | Zod-parsed on the way IN to every handler — a queue is a §9.1 boundary              |
| Cache metrics keys                     | Namespace only. `search:{query}` records `search`; no customer's query is stored    |
| Backup files (DEBT-031)                | `0600` in a `0700` directory, `backups/` gitignored — verified on disk              |
| `pg_dump` connection                   | `PGPASSWORD` + flags, never a URL in argv where `ps` reads it                       |
| Restore scratch database               | Name derived (`<db>_restore_check`); the drop cannot target the source              |
| §9.1's six headers                     | All six still on a live response — CSP, HSTS, nosniff, frame, referrer, permissions |
| Zod on every route + Server Action     | 37 tests, still green with the new health branch                                    |
| Sitemap after §9.6                     | Zero `/admin`, `/bills`, `/account`, `/claim`, `/calculator/s` entries              |
| `pnpm audit`                           | "No known vulnerabilities found"                                                    |

One near-miss worth recording: the first pass of this review reported HSTS, `nosniff` and
`X-Frame-Options` as missing. They were not — the grep pattern was `x-frame:`, which cannot
match `X-Frame-Options:`. Checked against the raw response before writing it down.

## Verdict

**Zero CRITICAL. Zero HIGH outstanding** — SEC-040 was HIGH and is fixed with 5 regression
tests. SEC-041 and SEC-042 are LOW and fixed. Nothing is carried into DEBT from this review.

## SEC-043 · MEDIUM · fixed — SEC-029's role script could never have run as documented

Found while writing the production deploy steps, by running it rather than reading it.

`scripts/db-roles.sql` is the setup procedure for SEC-029's least-privilege split — the control
that makes DEBT-026's invoice-retention guarantee real by removing `DELETE` on `Order`,
`OrderItem` and `BillPdf` from the runtime role. Two defects, both of which only appear away
from the machine it was written on:

1. **The password never reached the server.** The role was created inside a `DO $$ … $$` block
   calling `format(…, :'app_password')`, and **psql does not interpolate `:'var'` inside
   dollar-quoted text**. It is passed through literally and the server answers
   `syntax error at or near ":"`. Verified empirically both ways before rewriting: the same
   `:'probe'` interpolates outside a DO block and errors inside one. Rewritten with `\gset`
   and `\if`, so the interpolation happens in ordinary SQL. Still idempotent.

2. **The database name was hardcoded.** `GRANT CONNECT ON DATABASE tirupati` and
   `REVOKE CREATE ON DATABASE tirupati` name the development database literally. A managed
   Postgres generates its own name, so both statements fail with
   `database "tirupati" does not exist` and, with `ON_ERROR_STOP` set, abort the script. Now
   `current_database()` inside a DO block — which needs no psql variable, so it is unaffected
   by (1).

**What this means about the control.** The privileges ARE in force on the development database
— proven again just now: `DELETE FROM "Order"` is refused, `has_schema_privilege(… 'CREATE')`
is false, and the three invoice tables show `INSERT, SELECT, UPDATE` and no `DELETE`. So
SEC-029's finding stands and the runtime role is genuinely restricted here. What was wrong is
the **procedure for reproducing it elsewhere**, and "elsewhere" is production.

The class of defect is one this project keeps meeting: a control that is correct where it was
built and has an untested path to where it matters. DEBT-047 (a scrubber never exercised
against the real transport), SEC-042 (a warning comment standing in for a guard), and now a
setup script that had never been run against a database it did not already know the name of.

Re-run end to end against a deliberately differently-named database, then against the real
migrated one, twice. Note the ordering it exposed: **migrations must run before this script**,
because the `REVOKE DELETE` needs the tables to exist.
