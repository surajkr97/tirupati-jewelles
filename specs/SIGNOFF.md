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

Not started. Phase 1 is signed off, so Phase 2 is clear to begin.

---

## Phase 3 — Authentication

Not started. Blocked on Phase 2 sign-off.

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
