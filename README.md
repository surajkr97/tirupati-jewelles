<div align="center">

# ✦ &nbsp;TIRUPATI JEWELLES&nbsp; ✦

<sub>**R A T E S** &nbsp;·&nbsp; **C A L C U L A T O R** &nbsp;·&nbsp; **B I L L I N G**</sub>

Gold rates move daily and bills have to be exact to the paisa.
An end-to-end storefront and back office for a jewellery shop.

![Next.js](https://img.shields.io/badge/Next.js_16-000?style=flat&logo=next.js&logoColor=fff)
![React](https://img.shields.io/badge/React_19-20232A?style=flat&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=fff)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat&logo=prisma&logoColor=fff)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-4169E1?style=flat&logo=postgresql&logoColor=fff)
![Redis](https://img.shields.io/badge/Redis_7-DC382D?style=flat&logo=redis&logoColor=fff)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=fff)

[tirupatijewelles.com](https://tirupatijewelles.com)

</div>

---

## What it does

Three features carry the product.

1. **Rates.** Gold 22K/18K per 10g and silver 999 per kg, with history and a sparkline.
   Every price on the site follows the day's rate — change it once and the catalogue, the
   calculator and new bills all reprice together.
2. **Calculator.** Price several pieces at once with weight, purity, making charge and GST,
   then share the estimate by link.
3. **Bill → PDF → WhatsApp → order.** The shop bills a phone number; the purchase lands in
   that customer's order history even if they have no account yet, claimed later by
   OTP-verified phone ownership.

There is **no checkout**. The final call to action is _Enquire on WhatsApp_, which removes
the payment gateway, PCI scope and refund logic from the project entirely.

## Two rules that govern the codebase

**Money is integer paise, never float.** `BigInt` in Prisma, `bigint` in TypeScript,
formatted for display at the last possible moment. Floats produce ₹0.01 discrepancies that
customers notice on an invoice.

**One pricing function.** `lib/pricing.ts` serves the calculator, product pages and bills.
Three implementations of GST rounding is three different totals for one purchase, and the
customer will find it.

## The stack, and why

### Core

| Package               | Why it is here                                                                                                                            |
| :-------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `next` · `react`      | App Router. Rates and product pages are ISR'd so the first paint already shows real numbers; admin is dynamic and behind auth.            |
| `typescript`          | Money is `bigint` and purity is a union. Both are type errors waiting to happen, and both are caught at compile time.                     |
| `prisma` + PostgreSQL | `BigInt` columns for money, migrations under review, and one generated client shared by the app and the scripts.                          |
| `ioredis` + Redis     | Cache-aside for rates, settings and the catalogue, plus rate limiting and OTP throttles. Every read degrades to Postgres if Redis is out. |
| `zod`                 | Validates env at boot (`lib/env.ts` throws rather than starting half-configured) and every form and API payload.                          |
| `server-only`         | A build-time error if a module that touches the database is ever imported into a client bundle.                                           |

### Money, documents and messaging

| Package               | Why it is here                                                                                                                      |
| :-------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `@react-pdf/renderer` | GST invoices rendered from the same React components and the same `lib/pricing.ts` the screen uses — one implementation, one total. |
| `resend`              | Transactional email: OTP, order confirmations, the branded bill. HTTPS only, so it works from a serverless function.                |
| `libphonenumber-js`   | Indian numbers arrive in half a dozen formats. One canonical E.164 value is what the order-claim flow matches on.                   |
| `swr`                 | Refetches the true rate every 5 minutes on the client, seeded from the server render so nothing flashes a skeleton.                 |

### Security and operations

| Package           | Why it is here                                                                                                                                                                                                     |
| :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@node-rs/argon2` | Password hashing. Argon2id is the current OWASP recommendation; the Rust binding keeps it fast enough to run per login.                                                                                            |
| `@sentry/nextjs`  | Wired through `instrumentation.ts`. A shop owner will not report a stack trace — the error has to arrive on its own.                                                                                               |
| `bullmq`          | The queue in `lib/queue/`. `enqueueOrRun` falls back to running the job inline, so a dead worker can never mean a dead billing feature.                                                                            |
| **Vercel Cron**   | The nightly sweep of expired share links (`/api/cron/cleanup`). Vercel is serverless with no long-lived process, so the schedule lives in `vercel.json` and calls the same function the worker would have (D-055). |

### Interface

| Package                                                | Why it is here                                                                                                                                                                |
| :----------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tailwindcss` v4                                       | Design tokens live in `@theme` in one stylesheet. The default spacing scale is off, so only the project's own scale compiles.                                                 |
| `clsx` · `tailwind-merge` · `class-variance-authority` | `cn()` resolves conflicts so a caller's prop can override a component default. `TEXT_SIZES` teaches it the custom type scale — without that it silently deletes size classes. |
| `lucide-react`                                         | One icon set, tree-shaken, sized from the same spacing tokens as everything else.                                                                                             |
| `vaul` · `sonner`                                      | The mobile sheet and the toasts. Both handle focus trapping and announcements that a hand-rolled version gets wrong.                                                          |

### Testing

| Package                | Why it is here                                                                                                                                        |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest`               | Unit tests, including a golden-file suite that pins every pricing total against a fixture.                                                            |
| `@playwright/test`     | End to end at 375 / 768 / 1280, against a real database and a real Redis.                                                                             |
| `@axe-core/playwright` | Accessibility assertions in the same run. Contrast is also gated by a unit test that parses `globals.css` itself.                                     |
| `@testing-library/*`   | Component tests that assert what is on screen rather than what is in state.                                                                           |
| `lighthouse`           | `pnpm lighthouse` for performance budgets.                                                                                                            |
| `eslint` · `prettier`  | Includes a local rule (`eslint-rules/no-off-scale-spacing.mjs`) that fails the build on a spacing value outside the scale — those emit no CSS at all. |

## Run it

Requires Node 20.9+ (**24 LTS recommended** — see DEBT-005), pnpm and Docker.

```bash
cp .env.example .env          # then fill in — lib/env.ts throws at boot on anything missing
docker compose up -d db redis # Postgres + Redis, bound to 127.0.0.1 only
pnpm install
pnpm exec prisma migrate deploy
pnpm seed                     # idempotent — safe to re-run
pnpm dev                      # → http://localhost:3000
```

Health check at [`/api/health`](http://localhost:3000/api/health) reports database and cache
reachability.

```bash
pnpm lint          # ESLint
pnpm typecheck     # tsc --noEmit
pnpm build         # prisma generate + production build
pnpm test          # Vitest
pnpm test:e2e      # Playwright at 375 / 768 / 1280
```

Operational scripts live in `scripts/`: `pnpm backup`, `pnpm verify:restore`,
`pnpm verify:degradation` (pull Redis and prove the app still serves), `pnpm cache:stats`,
`pnpm db:anonymise`.

## Layout

```
app/          (app)/ · admin/ · api/ · account/     Next.js App Router
components/   ui/ · rates/ · calculator/ · product/ · admin/ · shell/
lib/          env.ts · db.ts · redis.ts · pricing.ts · auth/ · bills/ · queue/
prisma/       schema.prisma · seed.ts · migrations/
scripts/      worker.mts · backup.mts · verify-*.mts
specs/        the build specification and its logs
e2e/          Playwright
```

## Specification

The nine build phases are complete and signed off. The UI redesign that followed is recorded
in the same way, stage by stage.

| File                                                 | Purpose                                                           |
| :--------------------------------------------------- | :---------------------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                             | Agent roles — DEV · TEST · DEBUG · SECURITY · DESIGN              |
| [`specs/00-MASTER-SPEC.md`](specs/00-MASTER-SPEC.md) | Stack, data model, design tokens, money rules. **Read first.**    |
| [`specs/01`–`09`](specs/)                            | The nine phases                                                   |
| [`specs/SIGNOFF.md`](specs/SIGNOFF.md)               | Phase status — one block per agent                                |
| [`specs/DECISIONS.md`](specs/DECISIONS.md)           | Deviations from spec, with reasoning                              |
| [`specs/DEBT.md`](specs/DEBT.md)                     | Deferred work                                                     |
| [`specs/SECURITY-LOG.md`](specs/SECURITY-LOG.md)     | Findings, severity, status                                        |
| [`specs/INVENTORY.md`](specs/INVENTORY.md)           | Every pre-rebuild file, and why it was kept, rewritten or deleted |

> [!NOTE]
> Two items in `DEBT.md` need a **business** decision, not an engineering one: GST treatment
> of making charges (confirm with a CA) and the consumer-protection exposure of the rate
> ticker's movement. Neither is tax nor legal advice.

---

<div align="center">
<sub>© Tirupati Jewelles — all rights reserved. Not open source.</sub>
</div>
