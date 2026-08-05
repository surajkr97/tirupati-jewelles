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
