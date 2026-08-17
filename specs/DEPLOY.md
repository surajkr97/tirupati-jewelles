# DEPLOY — first launch, start to finish

Phase 9 §9.8. The complete sequence for putting v2 live on Render, in order, assuming nothing
has been set up yet.

**Order matters in two places** and both are called out where they arise: the database tables
must exist before the role script runs, and the app must build once as the owner before it can
be switched to the restricted role. Everything else is linear.

Set aside about an hour. Do it on a quiet morning, not a Saturday evening.

---

## Part 1 — get the code to GitHub

Right now every commit lives only on the development machine. Nothing can deploy from a
laptop, and until this is done a disk failure loses the project.

**1. Check the working tree is clean.**

```bash
git status
```

Expect `nothing to commit, working tree clean`.

**2. Merge the rebuild into `master`.**

`master` is 0 commits ahead and `v2` is 44 ahead, so this is a fast-forward — no conflicts, no
merge commit.

```bash
git checkout master
git merge v2
```

**3. Push.**

```bash
git push origin master
```

GitHub Actions runs the test suite automatically. Wait for the green tick before continuing —
if it fails here, it would have failed on Render too, and this is the cheaper place to find out.

---

## Part 2 — the backing services (Supabase + Upstash)

Postgres is on **Supabase**, Redis on **Upstash**, and only the web service is on Render. That
is a normal split and needs no code change — but Supabase's connection model has one trap that
catches almost everyone, and this application happens to be built for it already.

### 4. Supabase — you need BOTH connection strings, not one

Supabase gives you two ways in, and Prisma needs both:

| Supabase calls it                    | Port   | Use it for                          |
| :----------------------------------- | :----- | :---------------------------------- |
| **Transaction pooler** (PgBouncer)   | `6543` | `DATABASE_URL` — the running app    |
| **Direct connection** / session mode | `5432` | `MIGRATE_DATABASE_URL` — migrations |

**Why both.** The pooler multiplexes many short queries onto few real connections, which is
what a web app wants and what keeps Supabase's connection limit from being hit. But it cannot
run the statements a migration needs — prepared statements and DDL in a transaction. Point
migrations at the pooler and they fail in confusing ways.

This project already splits those two variables for a different reason (SEC-029's owner/runtime
role split), so the shape fits exactly. Find both under **Project → Settings → Database →
Connection string**.

Append `?pgbouncer=true&connection_limit=1` to the pooled URL. Without `pgbouncer=true` Prisma
uses prepared statements the pooler cannot support, and you get intermittent
`prepared statement "s0" already exists` errors under load — the kind that pass every test and
fail on a busy afternoon.

**One thing to check before you rely on it:** Supabase's _direct_ connection is IPv6-only on
newer projects. If Render cannot reach it, the build fails at `pnpm db:deploy`. The fix is
Supabase's **session pooler** (IPv4, also port 5432), which supports migrations. Test it before
launch day rather than discovering it mid-deploy.

Note the database is called `postgres`, not `tirupati` — which is exactly why
`scripts/db-roles.sql` was fixed to use `current_database()` (SEC-043). The old version
hardcoded `tirupati` and would have aborted here.

### 5. Upstash — one setting, and one thing to verify

Use the **`rediss://`** URL (two s's — it is TLS). No code change is needed; `ioredis` turns on
TLS from the scheme, and `lib/env.ts` does not restrict it.

**Set the eviction policy to `noeviction`.** This is the setting that matters. Upstash defaults
some plans to evicting keys under memory pressure, and this instance is not only a cache — it
holds **sessions** (§3.3). Eviction there means customers and the admin being signed out at
random, which reads as a bug in the site and is impossible to reproduce.

Two things to verify against your plan rather than assume:

- **Per-command pricing.** This app talks to Redis on _every_ request — the proxy's rate limit,
  session lookups, cached rates. If you are on a pay-per-command plan, watch the first week's
  usage rather than the first month's bill.
- **Blocking commands.** The optional worker (BullMQ) needs a persistent connection and
  blocking commands, which some serverless tiers restrict. Not a launch blocker — skip the
  worker for now and check later.

### 6. Render — the Web Service

This is the site itself: the process that receives a customer's request, reads Supabase and
Upstash, and returns the page. Point it at the GitHub repo, branch `master`.

- **Build command:** `pnpm install --frozen-lockfile && pnpm db:deploy && pnpm build`
- **Start command:** `pnpm start`

`db:deploy` is `prisma migrate deploy` — forward-only, applies pending migrations, never
resets. **Never put `db:migrate` here**; that one resets the database when it detects drift.

Choose a Render region close to your Supabase region. Every query crosses that gap.

Do not deploy yet — it will fail without the environment variables, which is next.

### A note on the old website's data

**Do not drop the old tables.** Create a **new Supabase project** (or at minimum a new
database) for v2 and leave the old one alone until v2 has been live and proven for a week.

v2's schema is not an upgrade of the old site's — Phase 1 deleted that application and rewrote
everything, so the tables are unrelated. Migrating into a database that already holds old
tables would work and leave junk behind; a clean database means everything in it is v2's.
Dropping is irreversible and buys nothing today.

---

## Part 3 — the environment variables

**7. Generate the two secrets**, on your laptop:

```bash
openssl rand -base64 32   # for SESSION_SECRET
openssl rand -base64 32   # for OTP_PEPPER
```

These must be **new** — not the values from your `.env`. A development secret that leaks is a
development problem; the same secret in production is a production one.

**8. Set the variables on the Web Service.**

`lib/env.ts` validates all of these at boot and throws with the name of anything missing, so a
mistake here fails the deploy loudly rather than serving broken pages.

| Variable                    | Value                                                                    |
| :-------------------------- | :----------------------------------------------------------------------- |
| `DATABASE_URL`              | Supabase **pooled** URL, port 6543, `?pgbouncer=true&connection_limit=1` |
| `MIGRATE_DATABASE_URL`      | Supabase **direct** URL, port 5432. Needed at **build** time             |
| `REDIS_URL`                 | Upstash **`rediss://`** URL (TLS)                                        |
| `SESSION_SECRET`            | the first generated secret                                               |
| `OTP_PEPPER`                | the second generated secret                                              |
| `NEXT_PUBLIC_SITE_URL`      | the site's real address, e.g. `https://tirupatijewelles.com`             |
| `NEXT_PUBLIC_OWNER_WA`      | `919507769218` — digits only, no `+`                                     |
| `NEXT_PUBLIC_TICKER_JITTER` | `true`                                                                   |
| `SEED_ADMIN_EMAIL`          | the admin's email                                                        |
| `SEED_ADMIN_PASSWORD`       | a strong password — this is how you first sign in                        |
| `EMAIL_FROM`                | e.g. `Tirupati Jewelles <noreply@yourdomain.com>`                        |
| `RESEND_API_KEY`            | from resend.com — required for customer sign-in codes                    |
| `ALLOWED_IMAGE_HOSTS`       | `res.cloudinary.com,utfs.io`                                             |
| `CLOUDINARY_CLOUD_NAME`     | from your Cloudinary account                                             |
| `CLOUDINARY_API_KEY`        | from Cloudinary                                                          |
| `CLOUDINARY_API_SECRET`     | from Cloudinary                                                          |
| `SENTRY_DSN`                | from Sentry                                                              |
| `SENTRY_ENVIRONMENT`        | `production`                                                             |
| `TRUSTED_PROXY_HOPS`        | `1`                                                                      |
| `WHATSAPP_SENDER`           | `deep-link`                                                              |

> **`NEXT_PUBLIC_*` is baked into the JavaScript at build time.** Changing one of those later
> needs a **redeploy**, not a restart. The other variables take effect on restart.

---

## Part 4 — first deploy and the database

**9. Deploy.**

Watch the log. The build runs `pnpm db:deploy`, which creates all the tables. If it stops on a
missing variable, add it and deploy again — the message names the variable.

When it finishes, check:

```bash
curl https://your-site.onrender.com/api/health
```

Expect `200` and `"database":"ok"`. The `status` may say `degraded` — that is correct on a
fresh install, because no gold rate has been set yet.

**10. Create the restricted database role.**

Until now the app connects as the database **owner**, which can do anything. Production should
run with less: no ability to create tables, and **no ability to delete an invoice** — which is
what makes the six-year retention promise real rather than a convention.

The tables have to exist first, which is why this comes after the first deploy.

Use the Supabase **direct** connection URL (the same one as `MIGRATE_DATABASE_URL`), which
connects as `postgres` — the owner. On your laptop:

```bash
psql "<supabase direct URL>" -v app_password=choose-a-strong-password -f scripts/db-roles.sql
```

If you would rather not install `psql`, Supabase's SQL editor works too — but it cannot take
the `-v app_password` variable, so replace `:'app_password'` with a quoted password in the two
lines that use it before pasting.

It prints its own verification at the end. You want:

- `Schema CREATE (should be f)` → **f**
- the three invoice tables listing `INSERT, SELECT, UPDATE` and **no DELETE**

**11. Switch the app to the restricted role.**

In Render, change **`DATABASE_URL`** so the username is `tirupati_app` and the password is the
one you just chose. Leave `MIGRATE_DATABASE_URL` as the owner — migrations legitimately need
to change the schema.

Redeploy for it to take effect.

**12. Seed the shop.**

From Render's shell on the web service:

```bash
ALLOW_REMOTE_DB=1 pnpm seed
```

`ALLOW_REMOTE_DB=1` is required because the seed refuses to touch a non-local database unless
told to on purpose (D-054). This creates the admin account, the categories and the media slots.

---

## Part 4b — Vercel, and the one thing it does NOT do

This document is written for Render, and Render is safe by construction: its build command is
`pnpm install --frozen-lockfile && pnpm db:deploy && pnpm build`, so pending migrations are
applied **before** the build that depends on them.

**A Vercel project is also connected to this repository and serves Production.** It has no
`buildCommand` override in `vercel.json`, so it runs the package default — `prisma generate
&& next build` — which does **not** migrate.

That difference is invisible until a release adds a column and reads it in the same commit.
`next build` prerenders the ISR routes, `/` among them, so the build executes the queries in
`app/(app)/page.tsx` against the live database. A column the code selects and the database
does not have fails the build with `The column X does not exist in the current database`.

It happened on D-126, which added `MediaSlot.videoUrl` and selected it on the homepage: every
Vercel deployment of that branch failed while the three commits before it passed.

**So for any release containing a migration, on Vercel the order is:**

```bash
# 1. Apply the migration to the production database FIRST.
#    `migrate deploy` is forward-only and never resets — it is the safe one.
#    `db:migrate` is NOT safe here; it resets on drift. See scripts/guarded-migrate.mts.
MIGRATE_DATABASE_URL="<the production direct URL, port 5432>" pnpm exec prisma migrate deploy

# 2. Then merge, which triggers the deploy.
```

A failed Vercel build does not take the site down — the previous deployment keeps serving — so
getting this wrong costs a release, not an outage. Fix it by applying the migration and
redeploying.

The alternative, putting `pnpm db:deploy` into a Vercel `buildCommand`, is deliberately NOT
done: Vercel builds every pull request as a preview against the same environment, so it would
let an unmerged branch migrate the production database.

---

## Part 5 — check it actually works

**13. Sign in** at `https://your-site/login` with `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD`. Change the password immediately.

**14. Set today's gold and silver rates** at `/admin/rates`. Until this is done the site shows
seeded figures and `/api/health` reports `rates: warn`.

**15. Walk the three flagship flows** as a customer would:

- the homepage ticker shows the rate you just set
- `/calculator` prices an item
- a product page → **Enquire on WhatsApp** opens a message to the shop

**16. Raise one real bill** at `/admin/bills/new` and send it. This is the only way to know the
whole chain works: invoice number, PDF, WhatsApp message, claim link.

**17. Confirm the restricted role is really in force** — the check that proves step 10 took:

```bash
psql "<external URL, as tirupati_app>" -c 'DELETE FROM "Order" WHERE false;'
```

Expect `ERROR: permission denied for table Order`. That error is the feature.

---

## Part 6 — after launch, in priority order

**18. Backups.** Render's managed Postgres takes its own daily snapshots — confirm they are on
and note the retention. For a portable copy you can restore anywhere, `pnpm backup` on a
schedule; `pnpm backup --help` prints the cron line. Whatever you choose, **restore one before
you need to** — `pnpm verify:restore` proves a dump is real rather than hoping.

**19. Uptime checks.** Point a monitor at `/api/health`. It must assert the response **body**
contains `"status":"ok"` — the endpoint returns 200 while degraded on purpose, so a
status-code-only rule stays green through exactly the stale-rate alert you would want to hear
about (DEBT-047).

**20. The worker** (optional). A second Render service, type **Background Worker**, same repo
and environment, start command `pnpm worker`. Its only job today is deleting expired calculator
share links at 03:15 IST. Without it those rows accumulate slowly and harmlessly.

**21. Staging** — deferred on purpose (D-054). Build it before the first migration that is not
purely additive, or before any deploy that changes how money is calculated. The steps are in
`specs/09-hardening.md` §9.8.

---

## If something goes wrong

`specs/ROLLBACK.md`. The short version: Render → Events → the last good deploy → Redeploy, and
it is live again in about two minutes. Rolling back the **code** is easy; rolling back a
**migration** is not, which is why every migration so far is additive.
