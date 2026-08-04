# INVENTORY

Phase 1 §1.1. Every file in the pre-rebuild tree, in three buckets. **Written before anything
was deleted** — the tag `pre-rebuild-backup` (commit `0ba1222`) is the safety net; this file is
the reasoning.

Recover any deleted file with:

```bash
git show pre-rebuild-backup:<path>
```

**Totals:** 78 tracked files — 6 KEEP · 21 REWRITE · 51 DELETE.

---

## KEEP — dormant infrastructure, docker, env, CI

Retained as-is or relocated. Per MASTER-SPEC §2 and Phase 1 §1.3, the Celery + Redis setup is
**deliberately dormant infrastructure** and must not be removed by a future agent or
dead-code tool.

| Path                                                    | Disposition                                 | Why                                                                                                                                                                             |
| :------------------------------------------------------ | :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/app/celery_app.py`                              | → `backend/celery_app/celery.py`            | Broker config is the thing worth keeping. The two `beat_schedule` entries pointed at the deleted gold-rate tasks and are stripped; the app object and Redis connection survive. |
| `server/docker-compose.yml` + root `docker-compose.yml` | → merged into one root `docker-compose.yml` | Postgres, Redis, worker services survive. The FastAPI `api` service and the `include:` indirection go. **Redis and Postgres port publishing removed** — see SEC-001.            |
| `server/Dockerfile`                                     | → `backend/Dockerfile`                      | Rewritten for the worker only; no longer serves uvicorn.                                                                                                                        |
| `server/.env.example`                                   | → root `.env.example`                       | Rewritten wholesale to MASTER-SPEC §9. Only `DATABASE_URL` and `REDIS_URL` carry over by name.                                                                                  |
| `.github/workflows/tests.yml`                           | rewritten in place                          | Redis service container and CI shape are reusable; the pytest invocation is replaced by Vitest + Playwright.                                                                    |
| `.vscode/settings.json`                                 | unchanged                                   | Editor config, stack-agnostic.                                                                                                                                                  |

---

## REWRITE — application code replaced by a Next.js equivalent

These implement concepts the new build still needs, but the spec relocates them to the
Next.js side (Postgres + Prisma, Argon2id + Redis session cookie). **None is ported line by
line**; each is superseded by the phase named.

| Path                                                                                                          | Superseded by                                                                                                                                                               | Phase   |
| :------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------ |
| `server/main.py`                                                                                              | `app/layout.tsx` + route handlers; CORS becomes same-origin                                                                                                                 | 1       |
| `server/app/core/config.py`                                                                                   | `lib/env.ts` (Zod, throws at boot)                                                                                                                                          | 1       |
| `server/app/database.py`                                                                                      | `lib/db.ts` (Prisma singleton)                                                                                                                                              | 1       |
| `server/app/cache.py`                                                                                         | `lib/redis.ts` + `cached()` cache-aside helper                                                                                                                              | 1       |
| `server/app/models/user.py`                                                                                   | `model User` in `schema.prisma`                                                                                                                                             | 1       |
| `server/app/models/gold_rate.py`                                                                              | `model MetalRate` — note the unit change: `Numeric` rupees/gram → `BigInt` **paise** per gram (MASTER-SPEC §4)                                                              | 1       |
| `server/app/models/__init__.py`                                                                               | —                                                                                                                                                                           | 1       |
| `server/alembic.ini`, `alembic/env.py`, `alembic/README`, `alembic/script.py.mako`                            | `prisma migrate`                                                                                                                                                            | 1       |
| `server/alembic/versions/*.py` (3 migrations)                                                                 | `prisma/migrations/…_init`                                                                                                                                                  | 1       |
| `server/app/auth/*` (8 files: router, service, tokens, cookies, passwords, dependencies, schemas, `__init__`) | `lib/auth/` — **opaque Redis session, not JWT** (spec §3.3 prefers it for real server-side revocation), Argon2id replaces the current hashing, plus OTP which never existed | 3       |
| `server/app/schemas/user.py`, `schemas/gold_rate.py`, `schemas/__init__.py`                                   | Zod schemas at each route boundary                                                                                                                                          | 1, 3, 4 |
| `frontend/src/app/layout.tsx`                                                                                 | new root `app/layout.tsx`                                                                                                                                                   | 1       |
| `frontend/src/app/page.tsx`                                                                                   | new `app/(app)/page.tsx` — "Coming soon" in Phase 1, real homepage in Phase 4                                                                                               | 1, 4    |
| `frontend/src/app/globals.css`                                                                                | new `app/globals.css` with MASTER-SPEC §3 tokens                                                                                                                            | 2       |
| `frontend/src/app/login/*`, `account/*`                                                                       | rebuilt under the Phase 2 design system                                                                                                                                     | 3       |
| `frontend/src/lib/auth.ts`, `api.ts`, `api-server.ts`                                                         | direct DB access from Server Components; no cross-origin API client needed once the app is one Next.js process                                                              | 1, 3    |
| `frontend/src/proxy.ts`                                                                                       | new root `proxy.ts` — route protection kept, rewritten for the new session model                                                                                            | 3       |
| `frontend/next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `package.json`         | root equivalents with stricter settings (`noUncheckedIndexedAccess`, `no-explicit-any: error`)                                                                              | 1       |
| `README.md`                                                                                                   | rewritten for the new architecture                                                                                                                                          | 9       |

---

## DELETE — live-price API, its tests, and dead experiments

### The external metal-price integration (Phase 1 §1.2)

MASTER-SPEC §1: _"Not in scope: … live market rate APIs."_ Rates are admin-controlled from
Phase 4 onward. Everything that reached out to `gold-api.com` goes.

| Path                                      | Note                                                                                                                                           |
| :---------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/app/adapters/gold_api_adapter.py` | The `gold-api.com` HTTP client. Also the home of `USD_TO_INR = 95.75`, a hardcoded FX constant.                                                |
| `server/app/adapters/__init__.py`         | Package existed only for the adapter.                                                                                                          |
| `server/app/tasks/fetch_gold_rate.py`     | Celery task polling the upstream at 09:00 IST.                                                                                                 |
| `server/app/tasks/cleanup_gold_rates.py`  | Weekly pruning of fetched history.                                                                                                             |
| `server/app/tasks/__init__.py`            | Package existed only for those two tasks.                                                                                                      |
| `server/app/services/rate_service.py`     | Pricing pipeline (USD/oz → INR/g → purity → display unit) and day-change arithmetic. Superseded by admin-set rates + `lib/pricing.ts`.         |
| `server/app/services/__init__.py`         | —                                                                                                                                              |
| `server/app/routes/rates.py`              | `/rates/live`, `/rates/history`, `/rates/internal/refresh`.                                                                                    |
| `server/app/routes/__init__.py`           | —                                                                                                                                              |
| `REFRESH_SECRET_KEY` env var              | Guarded the manual-refresh endpoint. Endpoint gone → var gone. Note `REFRESH_TOKEN_SECRET` (JWT signing) also goes, with the whole JWT scheme. |
| `requests` in `requirements.txt`          | Present only for the adapter.                                                                                                                  |

### Test suite for deleted behaviour

| Path                                             | Note                                                                                                     |
| :----------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| `server/tests/test_rates.py`                     | Tests the deleted rate service.                                                                          |
| `server/tests/test_auth.py`                      | Tests the deleted JWT auth. Phase 3 writes new tests from the spec's acceptance criteria, not from this. |
| `server/tests/conftest.py`, `server/conftest.py` | pytest fixtures — SQLite swap + Redis flush.                                                             |

### Dead experiments and artefacts

| Path                                                          | Note                                                                                                                                           |
| :------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| `.DS_Store`                                                   | macOS artefact, committed by accident. Added to `.gitignore`.                                                                                  |
| `frontend/CLAUDE.md`                                          | One line: `@AGENTS.md`. Redundant once `AGENTS.md` is at the root.                                                                             |
| `frontend/AGENTS.md`                                          | **Content preserved** — its Next.js-16-differs-from-training-data warning is carried into the new root `AGENTS.md` and D-002.                  |
| `frontend/README.md`                                          | Stock `create-next-app` boilerplate.                                                                                                           |
| `frontend/public/ban1..4.png`                                 | Placeholder hero banners. Phase 7 makes every image a `MediaSlot` the admin controls; Phase 2 renders a branded empty `ImageFrame` until then. |
| `frontend/Dockerfile`, `.dockerignore`, `frontend/.gitignore` | Superseded by root equivalents.                                                                                                                |
| `server/.gitignore`, `server/.dockerignore`                   | Superseded by root equivalents.                                                                                                                |
| `server/app/auth/__init__.py`, `core/__init__.py`             | Empty package markers.                                                                                                                         |

### Untracked local artefacts (gitignored, removed from the working tree)

`server/.env` · `server/.coverage` · `server/test.db` · `server/celerybeat-schedule.db` ·
`server/logs/gold_rate.log` · `server/.pytest_cache/` · `frontend/.env.local` ·
`frontend/tsconfig.tsbuildinfo` · `frontend/next-env.d.ts`

`server/.env` holds real local secrets. It was never committed (verified — see SEC-002) and is
deleted from the working tree rather than migrated; the new root `.env` is generated fresh
from `.env.example`.

---

## Findings raised during the audit

Logged to `SECURITY-LOG.md`:

- **SEC-001** — `server/docker-compose.yml` published Redis on `6379:6379` and Postgres on
  `5432:5432` to the host, with credentials `fastapi_user` / `fastapi123` hardcoded in the
  compose file. Phase 1 SECURITY explicitly requires Redis not be exposed on a public port.
  Fixed in the merged root compose.
- **SEC-002** — `git log -p` secret scan across all history: result recorded in
  `SECURITY-LOG.md`.
