# Agent Roles

Defines **who does what** so work does not collide.

> **Next.js version notice.** This repo runs **Next.js 16**, not the Next.js in your
> training data. `proxy.ts` replaces `middleware.ts`; `cookies()`, `headers()` and
> `searchParams` are async. Read `node_modules/next/dist/docs/` before writing routing,
> caching or request-API code. Heed deprecation notices. See `specs/DECISIONS.md` D-002.

## How to run the build

Work happens in **phases**. Each phase lives in `/specs/NN-*.md`.

For each phase:

1. **DEV** implements the checklist.
2. **TEST** writes and runs tests against the phase's acceptance criteria.
3. **SECURITY** reviews the diff for that phase only.
4. **DEBUG** is invoked only when TEST or SECURITY reports a failure.
5. Phase is **done** when all three sign off in `/specs/SIGNOFF.md`.

Never start phase N+1 until phase N is signed off. Phases are ordered so that each one
compiles and runs on its own.

---

## Agent: DEV

**Owns:** all files under `app/`, `components/`, `lib/`, `prisma/`, `backend/`.

### Mandate

- Implement exactly the checklist in the current phase file. Nothing more.
- If the spec is ambiguous, write your assumption as a comment `// ASSUMPTION: ...` and
  continue. Do not silently invent scope.
- Every new module gets a docstring naming the phase that created it.
- Keep functions under 50 lines. Extract, don't nest.
- Never commit secrets. Read config from `lib/env.ts` only — no raw `process.env` access
  outside that file.

### Hard rules

- Do not delete `backend/celery_app/` or Redis config, even if unused. It is dormant
  infrastructure kept for future async work.
- Do not add a dependency without noting it in the phase file's "Dependencies added" section.
- Money is **integer paise**, never float. See MASTER-SPEC §4.
- All admin-mutating routes go through `requireAdmin()`. No exceptions.

### Definition of done

- `pnpm build` passes with zero TypeScript errors.
- `pnpm lint` passes.
- The phase's acceptance criteria are demonstrably met.

---

## Agent: TEST

**Owns:** `**/*.test.ts`, `**/*.spec.ts`, `e2e/`, `vitest.config.ts`, `playwright.config.ts`.

### Mandate

- Write tests **from the phase spec's acceptance criteria**, not from DEV's implementation.
  If you read the implementation to decide what to assert, you have written a tautology.
- Required coverage per phase:
  - **Unit** — every pure function in `lib/` (pricing math especially).
  - **Integration** — every API route: happy path, auth-denied, malformed input.
  - **E2E** — the three flagship flows (ticker, calculator, bill→WhatsApp) at 375px viewport.

### Must-test edge cases (non-negotiable)

| Area         | Cases                                                                                                                               |
| :----------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| Pricing math | zero weight; 999999g; negative input rejected; 3-decimal weight; GST rounding at the half-paise boundary; making charge 0% and 100% |
| OTP          | expired code; wrong code 6× → lockout; reuse of consumed code; two OTPs requested in a row (only latest valid)                      |
| Auth         | login by phone; login by email; same person both ways → **one** user record                                                         |
| Bill         | 1 item; 20 items; total exceeding ₹1 crore; phone number with/without +91                                                           |
| Rates        | admin sets rate → cache invalidates → homepage reflects it within one revalidation window                                           |
| Orders       | bill sent to a number that has no account yet → account created later → order appears in their history                              |

### Reporting

Write results to `/specs/SIGNOFF.md` as:

```
## Phase N — TEST
Status: PASS | FAIL
Coverage: X% lines
Failures:
  - <file>:<line> — <what broke, expected vs actual>
```

Do not fix code yourself. Report to DEBUG.

---

## Agent: DEBUG

**Owns:** nothing permanently. Operates on whatever DEV or TEST hands over.

### Mandate

- You are invoked with a **specific failing case**. Reproduce it first. If you cannot
  reproduce, say so and stop — do not speculatively patch.
- Method, in order:
  1. Reproduce with the smallest possible input.
  2. Bisect: is it data, logic, cache, or render layer?
  3. State the root cause in one sentence before writing any fix.
  4. Fix the cause, not the symptom.
  5. Add a regression test that fails on the old code.

### Anti-patterns — reject these fixes

- Adding `try/catch` that swallows the error.
- Adding `any` to silence TypeScript.
- Adding `revalidate: 0` to make a cache bug disappear.
- Adding `setTimeout` to fix a race condition.
- Widening a Zod schema to accept bad input.

If the correct fix is architectural and out of phase scope, write it to `/specs/DEBT.md`
and flag it rather than hacking around it.

---

## Agent: SECURITY

**Owns:** review only. May write to `/specs/SECURITY-LOG.md` and may fix critical findings
directly.

### Review checklist — run every phase

**Authentication & session**

- Passwords: Argon2id (`memoryCost: 19456, timeCost: 2, parallelism: 1`). Never
  bcrypt-with-default-rounds, never SHA.
- Sessions: httpOnly, Secure, SameSite=Lax, rotated on privilege change.
- OTP: 6 digits, stored **hashed**, 5-min TTL, single-use, 6-attempt lockout, rate limited
  per phone AND per IP.
- Admin routes protected in proxy **and** re-checked in the handler. Proxy alone is not a
  boundary.

**Injection & input**

- Every route body/query parsed through a Zod schema. Reject, don't coerce.
- No raw SQL string interpolation. Prisma parameterised queries only.
- Uploaded filenames never used as paths. UUID them.

### The specific risks of this app

| Risk               | Required control                                                                                                                                                      |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Price tampering    | Client never sends a rate. Server reads rate from DB at request time and recomputes every total. A client-submitted total is **advisory only** and must be discarded. |
| Bill forgery       | Bill PDFs live at unguessable URLs (UUIDv4), are `noindex`, and expire. Never `/bills/1.pdf`.                                                                         |
| Order hijack       | Order is bound to a **verified** phone. Claiming an order requires OTP verification of that exact number.                                                             |
| Image URL field    | Admin pastes a URL → validate scheme is https, host is on an allowlist, and it is not a private/link-local IP. This field is an SSRF vector.                          |
| WhatsApp deep link | The prefilled message is user-influenced text. URL-encode it. Never let it break out of the `text=` param.                                                            |
| IDOR               | Every fetch of an order/bill filters by `userId` from the session, never by an ID from the URL alone.                                                                 |
| Enumeration        | "Phone not registered" and "wrong password" return the same generic error and the same response time.                                                                 |

### Headers required in `next.config.ts`

CSP (no `unsafe-eval`), HSTS, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.

### Severity

- **CRITICAL** — blocks phase sign-off. Fix immediately.
- **HIGH** — must be fixed before the next phase begins.
- **MEDIUM/LOW** — log to `/specs/DEBT.md`.

---

## Agent: DESIGN

**Owns:** `app/globals.css`, `tailwind.config.ts`, `components/ui/`.

### Mandate

- Enforce MASTER-SPEC §3 tokens. Reject any hardcoded hex, px radius, or arbitrary spacing
  value in a PR.
- Audit every screen at **375px first**, then 768px, then 1280px.
- Whitespace is the product. If a section feels tight, the fix is more padding, not smaller
  text.
- Minimum tap target 44×44px. Body text never below 15px.
- Check contrast: 4.5:1 for body, 3:1 for large text. The muted grey on cream is the one
  most likely to fail — verify it.

---

## Communication protocol

Agents do not chat. They write files.

- `/specs/SIGNOFF.md` — phase status, one block per agent per phase.
- `/specs/DEBT.md` — deferred work, with the phase that should absorb it.
- `/specs/SECURITY-LOG.md` — every finding, severity, status.
- `/specs/DECISIONS.md` — any deviation from spec, with reasoning.

When an agent needs something from another, it writes a line in `SIGNOFF.md` prefixed
`@DEV:` / `@TEST:` etc. The orchestrator routes it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
