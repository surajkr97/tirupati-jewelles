<div align="center">

# ✦ &nbsp;TIRUPATI JEWELLES&nbsp; ✦

<sub>**R A T E S** &nbsp;·&nbsp; **C A L C U L A T O R** &nbsp;·&nbsp; **B I L L I N G**</sub>

A mobile-first jewellery retail platform for the Indian market.

![Next.js](https://img.shields.io/badge/Next.js_16-000?style=flat&logo=next.js&logoColor=fff)
![React](https://img.shields.io/badge/React_19-20232A?style=flat&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=fff)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat&logo=prisma&logoColor=fff)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-4169E1?style=flat&logo=postgresql&logoColor=fff)
![Redis](https://img.shields.io/badge/Redis_7-DC382D?style=flat&logo=redis&logoColor=fff)

</div>

---

> [!IMPORTANT]
> **This is a v2 rebuild, in progress.** The build follows a nine-phase specification in
> [`specs/`](specs/). **Phase 1 of 9 is complete and signed off**; the app currently renders
> a "Coming soon" homepage over a fully migrated database.
>
> Read [`specs/00-MASTER-SPEC.md`](specs/00-MASTER-SPEC.md) first, then
> [`AGENTS.md`](AGENTS.md). Progress lives in [`specs/SIGNOFF.md`](specs/SIGNOFF.md).
>
> The pre-rebuild FastAPI application is preserved at the git tag `pre-rebuild-backup` and
> accounted for file-by-file in [`specs/INVENTORY.md`](specs/INVENTORY.md).

## What it will be

Three features carry the product:

1. **Rate ticker** — admin-set gold 22K/18K (per 10g) and silver 999 (per kg), displayed
   with a live feel. The displayed jitter is _presentation only_ and never touches money.
2. **Multi-item calculator** — price several pieces at once with making charges and GST.
3. **Bill → PDF → WhatsApp → auto-order** — the admin bills a phone number; the purchase
   lands in that customer's order history even if they have no account yet, claimed later
   by verified-OTP phone ownership.

There is **no checkout**. The final CTA is _Enquire on WhatsApp_ — which removes payment
gateway, PCI scope and refund logic from the project entirely.

## Two rules that govern the codebase

**Money is integer paise, never float.** `BigInt` in Prisma, `bigint` in TypeScript.
Formatted for display at the last possible moment. Floats produce ₹0.01 discrepancies that
customers notice on an invoice.

**One pricing function.** `lib/pricing.ts` (Phase 5) serves the calculator, product pages
and bills. Three implementations means three totals for one purchase.

## Run it

Requires Node 20.9+ (**24 LTS recommended** — see DEBT-005), pnpm, and Docker.

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
pnpm build         # typecheck + production build
pnpm test          # Vitest unit tests
pnpm test:e2e      # Playwright at 375 / 768 / 1280
```

### The Celery worker does nothing on purpose

`backend/celery_app/` connects to Redis, runs, and executes exactly one no-op task. It is
**dormant infrastructure**, kept deliberately so Phase 9 can move PDF generation and rate
rollups onto a broker that is already proven to work.

**Do not delete it.** See [`backend/celery_app/README.md`](backend/celery_app/README.md).

```bash
docker compose up -d --build worker
docker compose exec worker python -c \
  "from celery_app.tasks.health import ping; print(ping.delay().get(timeout=10))"   # → pong
```

## Layout

```
app/          (app)/ · admin/ · api/ · account/     Next.js App Router
components/   ui/ · rates/ · calculator/ · product/ · admin/
lib/          env.ts · db.ts · redis.ts · auth/ · utils/
prisma/       schema.prisma · seed.ts · migrations/
backend/      celery_app/ — dormant, do not delete
specs/        the build specification and its logs
e2e/          Playwright
```

## Specification

| File                                                 | Purpose                                                           |
| :--------------------------------------------------- | :---------------------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                             | Agent roles — DEV · TEST · DEBUG · SECURITY · DESIGN              |
| [`specs/00-MASTER-SPEC.md`](specs/00-MASTER-SPEC.md) | Stack, data model, design tokens, money rules. **Read first.**    |
| [`specs/01`–`09`](specs/)                            | The nine phases                                                   |
| [`specs/SIGNOFF.md`](specs/SIGNOFF.md)               | Phase status — one block per agent                                |
| [`specs/INVENTORY.md`](specs/INVENTORY.md)           | Every pre-rebuild file, and why it was kept, rewritten or deleted |
| [`specs/DECISIONS.md`](specs/DECISIONS.md)           | Deviations from spec, with reasoning                              |
| [`specs/DEBT.md`](specs/DEBT.md)                     | Deferred work                                                     |
| [`specs/SECURITY-LOG.md`](specs/SECURITY-LOG.md)     | Findings, severity, status                                        |

> [!NOTE]
> Two items in `DEBT.md` need a **business** decision, not an engineering one: GST
> treatment of making charges (confirm with a CA) and the consumer-protection exposure of
> the rate ticker's jitter. Neither is tax or legal advice.

---

<div align="center">
<sub>© Tirupati Jewelles — all rights reserved. Not open source.</sub>
</div>
