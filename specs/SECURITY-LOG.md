# SECURITY LOG

Every finding, with severity and status. Written by the SECURITY agent.

**Severity policy:** CRITICAL blocks phase sign-off · HIGH must be fixed before the next phase
begins · MEDIUM/LOW is logged to `DEBT.md`.

| ID      | Phase | Finding                                                                                                                                                                                                                                           | Severity | Status                                                                                                                                                                                                                                                                                                                                                                  |
| :------ | :---- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-001 | 1     | `server/docker-compose.yml` published Redis on `6379:6379` and Postgres on `5432:5432` to the host. Phase 1 SECURITY requires Redis not be reachable on a public port; on a laptop on shared wifi an unauthenticated Redis is remotely reachable. | HIGH     | FIXED — port publishing removed in the merged root compose; both reachable only on the compose network. Redis additionally requires a password.                                                                                                                                                                                                                         |
| SEC-002 | 1     | Committed credential: `POSTGRES_PASSWORD: fastapi123` hardcoded in `server/docker-compose.yml`, present throughout git history alongside user `fastapi_user`. Local-dev only, never a production database.                                        | MEDIUM   | FIXED — **rotated**, not merely moved. Compose now reads `POSTGRES_USER` / `POSTGRES_PASSWORD` from `.env`, and `.env.example` ships a placeholder. The old pair is dead. Per Phase 1 SECURITY, history rewriting was judged unnecessary: the credential never guarded anything but a local throwaway database.                                                         |
| SEC-003 | 1     | History secret scan (`git log -p --all`) across every commit.                                                                                                                                                                                     | INFO     | CLEAN — no production secret ever committed. `.env` / `.env.local` never tracked (verified by `--diff-filter=A`). Remaining matches are test fixtures (`PASSWORD = "supersecret123"` in `server/tests/test_auth.py`) and CI placeholders (`test-refresh-token-secret`, `test-secret-key` in `.github/workflows/tests.yml`) — all in deleted files, none valid anywhere. |

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
