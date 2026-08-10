# ROLLBACK

Phase 9 §9.8: "Rollback plan documented."

What to do when a deploy is wrong. Written against this system specifically — Render, Prisma,
Postgres 16, Redis 7, ISR — not as a generic runbook.

> **Read the first section before you ship, not when it is on fire.** Most of this plan is
> about a decision taken at deploy time, and by the time you want to roll back the cheap
> option may already be gone.

---

## 1. A deploy is three things, and they roll back at different speeds

| Layer      | Reversible? | How                                                          |
| :--------- | :---------- | :----------------------------------------------------------- |
| **Code**   | Yes, ~2 min | Render → the previous deploy → **Redeploy**                  |
| **Schema** | **No**      | `prisma migrate deploy` is forward-only — no down migrations |
| **Data**   | **Never**   | Bills raised, invoice numbers consumed, sessions created     |

Rolling back the code does **not** undo a migration. If the new deploy dropped a column and
you redeploy the old code, the old code queries a column that no longer exists and every page
500s — a worse outage than the one you were fixing.

So the question is never "can I roll back". It is **"is this migration backward-compatible?"**,
and the answer must be known before the deploy, not after.

### Classify every migration before shipping it

**Safe to roll back** — the old code still runs against the new schema:

- adding a nullable column
- adding a new table
- adding an index
- widening a type

**NOT safe** — the old code breaks against the new schema:

- dropping or renaming a column or table
- adding a `NOT NULL` column with no default
- narrowing a type, or adding a constraint existing rows violate

For anything in the second list, use the **expand/contract** pattern instead of a single
deploy. Three deploys, each individually reversible:

1. **Expand** — add the new column alongside the old one. Both exist. Roll back freely.
2. **Migrate** — deploy code that writes both and reads the new one. Backfill. Roll back freely.
3. **Contract** — a later deploy, days later, drops the old column once you are sure.

The cost is two extra deploys. The alternative is a schema change you cannot undo on the day
the shop is losing sales.

All 10 migrations to date are additive.

---

## 2. Decide: roll back, or roll forward?

**Roll forward** (deploy a fix) when:

- the migration is not backward-compatible — rolling back is the more dangerous move
- the bug is cosmetic, or affects one screen
- you know the fix and it is small

**Roll back** when:

- the site is down or money is wrong (a price, a GST figure, a bill total)
- you do not yet know the cause
- the last deploy's migration was additive or there was none

**A wrong price is a roll-back, not a roll-forward.** MASTER-SPEC §8 treats a displayed price
as a consumer-protection exposure; every minute it is wrong is a minute a customer can act on
it. Get back to a known-good build first, diagnose second.

---

## 3. The procedure

### 3.1 Stop the bleeding (≈2 minutes)

1. **Render → the web service → Events** — find the last deploy that was known good.
2. **Redeploy** it. Render builds from that commit; the container is fresh, so the ISR cache
   starts empty and no stale HTML from the bad build survives.
3. Watch `/api/health` until `checks.database.status` is `ok`.

If the rate itself is the problem and you do not want to wait for a deploy at all, the
**ticker off-switch is instant**: `/admin/settings` → turn jitter off. MASTER-SPEC §8 calls it
the legal insurance and §9.3's settings path takes effect without a build.

### 3.2 Check what the bad build left behind

A deploy that ran for even a few minutes may have created data the old code does not
understand. In order of how much it matters:

**Invoice numbers — check first.** `BillSequence` is a counter and §8.2 allocates inside the
transaction that writes the order. **It cannot give a number back.** If bills were raised
under the bad build:

- do **not** reset the sequence to "reuse" the numbers — a gap is legal and normal; a
  duplicate invoice number is not
- do **not** delete the orders. You cannot anyway: SEC-029 revoked `DELETE` on `Order`,
  `OrderItem` and `BillPdf` from the runtime role, precisely so a cleanup cannot breach the
  six-year retention rule (DEBT-026). That refusal is a feature on this day.
- if a bill is wrong, **void it** (`voidedAt`) and raise a corrected one. That is §8.5's
  designed path and it leaves an auditable trail.

**Sessions.** They live in Redis. A rollback does not touch them, so customers stay signed in.
Only flush Redis if the bad build wrote a session shape the old code cannot read — and know
that flushing signs **everyone** out, including the admin mid-bill.

**Caches.** Nothing to do. A fresh container has an empty ISR cache, and `rates:current`,
`settings:*` and `search:*` all expire within 300 seconds. If you want them gone immediately,
`redis-cli DEL rates:current settings:pricing settings:contact`.

### 3.3 If the schema has to go back

Only when a non-backward-compatible migration shipped and rolling forward is not viable.
**This is the expensive path — it costs data written since the backup.**

1. Put the site in maintenance (Render → suspend, or scale to zero).
2. Take a backup of the current state **first**: `pnpm backup`. You are about to overwrite the
   database, and the bad state is still evidence.
3. Restore the last good dump into a **scratch database** and check it before touching the
   real one — `pnpm verify:restore` does exactly this and compares row counts, invoice PDF
   bytes, money totals, every index and the migration ledger.
4. Restore into production only once the scratch check passes.
5. Redeploy the matching code.

**Everything written between the backup and now is gone.** With a nightly backup that is up to
24 hours of orders. This is why §2's expand/contract pattern is worth two extra deploys.

---

## 4. Things specific to this system that will surprise you

- **`NEXT_PUBLIC_*` is baked in at build time.** `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_OWNER_WA`
  and `NEXT_PUBLIC_TICKER_JITTER` are inlined into the JavaScript. Rolling back the code rolls
  back those values to whatever they were at that build, and changing one in Render's
  dashboard does nothing until a **rebuild** — not a restart.
- **The WhatsApp number is the exception**, deliberately. Since DEBT-050 it is read from the
  `Settings` row at request time, so it survives a rollback and can be corrected without a
  deploy. That is the pattern to prefer for anything the owner must be able to change.
- **`lib/env.ts` throws at boot on a missing variable.** A rollback to a commit that required a
  variable you have since deleted from Render will fail to start rather than serve broken
  pages. The failure is loud and immediate — read the deploy log, re-add the variable.
- **Redis being down is not an outage.** §9.5 proved the site serves with Redis stopped. Do not
  roll back a deploy because Redis is unhealthy; fix Redis. Note the one exception: **signing
  in stops working**, because the auth limiter fails closed by design.
- **Postgres being down IS an outage**, and the ISR cache will keep serving pages for a while,
  which can make it look healthier than it is. `/api/health` returns 503 and is the truth.

---

## 5. Before you deploy — the 60-second checklist

- [ ] Does this deploy include a migration? If yes, is it additive? If not, has it been split
      expand/contract?
- [ ] Is there a backup from today? (`ls backups/` or the provider's snapshot list.)
- [ ] Do you know which deploy is the known-good one to go back to?
- [ ] Are you deploying while the shop is open? Prefer after closing — an invoice raised
      during a bad window is the one thing that cannot be undone.

---

## 6. After any rollback

Write down what happened in `specs/DEBT.md` or `SECURITY-LOG.md` as appropriate, including the
thing that is easy to skip: **why the bad deploy passed the tests.** A rollback that does not
produce a new test is a rollback you will do again.
