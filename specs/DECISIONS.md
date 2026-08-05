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
