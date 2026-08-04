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
