# PHASE 1 — Cleanup & Scaffold

**Goal:** strip the existing mixed-up codebase down to a clean, running skeleton. Preserve
Redis and Celery infrastructure. Delete the live-rate API integration.

**Agents:** DEV → SECURITY → TEST

---

## Context for DEV

The current repo is a learning project — Redis, Celery, and a third-party live metal-price
API tangled together with half-finished UI. We are keeping the infrastructure and throwing
away the application layer.

**The Celery and Redis setup is deliberately retained as dormant infrastructure.** It will be
used later (Phase 9 lists candidate jobs). Deleting it and re-adding it later costs more than
leaving it running as a no-op. Do not remove it, and do not let a linter or dead-code tool
remove it either.

---

## DEV checklist

### 1.1 Audit before deleting

- [x] `git checkout -b rebuild/clean-slate` — **deviation:** branch is `v2`, see D-001
- [x] Tag the current state: `git tag pre-rebuild-backup` → commit `0ba1222`
- [x] Write `/specs/INVENTORY.md` listing every existing file in three buckets:
      **KEEP** (Redis/Celery/docker/env), **REWRITE** (any app code),
      **DELETE** (live-price API code, dead experiments).
- [x] Do not delete anything until INVENTORY.md is written. The tag is the safety net; the
      inventory is the reasoning.

### 1.2 Remove the live-price API

- [x] Delete all fetchers, cron jobs, webhook handlers, and types for the external
      metal-rate provider.
- [x] Remove its env vars from `.env.example` and any secret store.
- [x] `grep -ri "goldapi\|metalprice\|live.*rate\|api.*price" --include="*.ts" --include="*.py"`
      → must return zero application hits.
- [x] Remove the dependency from `package.json` / `requirements.txt`.

### 1.3 Preserve Celery + Redis

- [x] Keep `backend/celery_app/` with: `celery.py` (app + Redis broker config),
      `tasks/health.py` containing one task:

```python
@app.task(name="health.ping")
def ping() -> str:
    """No-op keepalive. Phase 9 will add real jobs here.
    DO NOT DELETE — dormant infrastructure, intentionally unused."""
    return "pong"
```

- [x] Keep `redis` and `celery` services in `docker-compose.yml`.
- [x] Add `backend/celery_app/README.md` explaining the dormancy so no future agent or
      contributor deletes it as dead code.
- [x] Verify: `docker compose up` → worker connects to Redis, logs "ready".

### 1.4 Scaffold Next.js

- [x] Next.js 16 (D-002), App Router, TypeScript **strict**, Tailwind, ESLint.
- [x] Directory layout:

```
app/          (app)/ · admin/ · api/ · account/
components/   ui/ · rates/ · calculator/ · product/ · admin/
lib/          env.ts · db.ts · redis.ts · pricing.ts · auth/ · utils/
prisma/       schema.prisma · seed.ts
specs/        (these files, plus SIGNOFF/DEBT/SECURITY-LOG)
e2e/
```

- [x] `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`,
      `noImplicitOverride: true`. Path alias `@/*`.
- [x] Prettier + ESLint with `@typescript-eslint/no-explicit-any: error`.

### 1.5 Core lib files

- [x] `lib/env.ts` — Zod schema over `process.env`, parsed once, exported as a typed object.
      **Throws at boot if anything is missing.** Add an ESLint rule banning `process.env`
      outside this file.
- [x] `lib/db.ts` — Prisma singleton, guarded against hot-reload duplication.
- [x] `lib/redis.ts` — ioredis singleton **plus** the cache-aside helper:

```ts
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T>;
```

On any Redis error: log, call `fetcher()`, return the result. **Never throw.** Redis down =
slow site, not broken site. Write this now; every later phase depends on it behaving this
way.

### 1.6 Database

- [x] Full `schema.prisma` from MASTER-SPEC §5. All models, all indexes.
- [x] `prisma migrate dev --name init`
- [x] `prisma/seed.ts`:
  - one ADMIN user (credentials from env, **not** hardcoded)
  - starter categories: Rings, Necklaces, Earrings, Bracelets, Chains, Bangles
  - opening `MetalRate` rows for all three purities
  - empty `MediaSlot` rows for every slot key
- [x] `pnpm seed` runs clean twice in a row (idempotent).

### 1.7 Baseline app

- [x] Root layout: Inter font, cream background, mobile viewport meta.
- [x] `/` renders "Coming soon" — no styling work yet, that's Phase 2.
- [x] Health route `/api/health` reporting DB + Redis reachability.
- [x] `.env.example` with every var from MASTER-SPEC §9, no real values.

---

## Dependencies added

`next@16` · `react@19` · `prisma` · `@prisma/client` · `ioredis` · `zod` · `tailwindcss` ·
`vitest` · `@playwright/test` · `@node-rs/argon2` (seed admin hashing) · `tsx` (seed runner)

---

## SECURITY review

- [x] `git log -p | grep -i "secret\|password\|api_key"` — no secrets in history. If found:
      rotate them, and note it in SECURITY-LOG.md. Rewriting history is optional; rotating
      the credential is not.
- [x] `.env` is gitignored; `.env.example` has placeholders only.
- [x] Seeded admin password comes from env and is Argon2id hashed.
- [x] Redis is not exposed on a public port in docker-compose.
- [x] `pnpm audit` — zero critical/high.

---

## TEST

- [x] `pnpm build` — zero TS errors.
- [x] `pnpm dev` — `/` renders.
- [x] `/api/health` returns DB ok + Redis ok.
- [x] Unit: `cached()` returns fetcher output when Redis is unreachable. (Point it at a dead
      port and assert it still resolves.)
- [x] `pnpm seed` twice → no duplicate rows.
- [x] Celery worker connects and `health.ping` returns `"pong"`.

---

## Acceptance criteria

1. App builds and runs; homepage renders.
2. Zero references to the external price API.
3. Celery worker running, connected, dormant, documented.
4. Redis helper degrades gracefully — verified by test, not by inspection.
5. Database migrated and seeded.
6. `INVENTORY.md` explains every deletion.

**Sign off in `/specs/SIGNOFF.md` before Phase 2.**
