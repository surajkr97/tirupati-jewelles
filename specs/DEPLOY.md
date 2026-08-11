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

## Part 2 — create the backing services

In the Render dashboard. Names are suggestions; use whatever makes them unmistakable.

**4. Create a PostgreSQL instance.** Version **16**, to match `docker-compose.yml`. Call it
`tirupati-db`. Note the region — everything else should be in the same one, or every query
crosses the internet.

**5. Create a Redis / Key Value instance.** Version **7**. Same region. Call it
`tirupati-redis`.

Redis holds sessions here, not just cache, so enable persistence if the plan offers it. Losing
it signs everyone out — survivable, but avoidable. (§9.5 measured exactly this.)

**6. Create the Web Service.** Point it at the GitHub repo, branch `master`.

- **Build command:** `pnpm install --frozen-lockfile && pnpm db:deploy && pnpm build`
- **Start command:** `pnpm start`
- **Region:** the same one as the database.

`db:deploy` is `prisma migrate deploy` — forward-only, applies pending migrations, never
resets. **Never put `db:migrate` here**; that one resets the database when it detects drift.

Do not deploy yet. It will fail without the environment variables, which is the next part.

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

| Variable                    | Value                                                          |
| :-------------------------- | :------------------------------------------------------------- |
| `DATABASE_URL`              | the Postgres **Internal** URL from Render — for now, the owner |
| `MIGRATE_DATABASE_URL`      | the same URL. Needed at **build** time (`prisma generate`)     |
| `REDIS_URL`                 | the Redis internal URL                                         |
| `SESSION_SECRET`            | the first generated secret                                     |
| `OTP_PEPPER`                | the second generated secret                                    |
| `NEXT_PUBLIC_SITE_URL`      | the site's real address, e.g. `https://tirupatijewelles.com`   |
| `NEXT_PUBLIC_OWNER_WA`      | `919507769218` — digits only, no `+`                           |
| `NEXT_PUBLIC_TICKER_JITTER` | `true`                                                         |
| `SEED_ADMIN_EMAIL`          | the admin's email                                              |
| `SEED_ADMIN_PASSWORD`       | a strong password — this is how you first sign in              |
| `EMAIL_FROM`                | e.g. `Tirupati Jewelles <noreply@yourdomain.com>`              |
| `RESEND_API_KEY`            | from resend.com — required for customer sign-in codes          |
| `ALLOWED_IMAGE_HOSTS`       | `res.cloudinary.com,utfs.io`                                   |
| `CLOUDINARY_CLOUD_NAME`     | from your Cloudinary account                                   |
| `CLOUDINARY_API_KEY`        | from Cloudinary                                                |
| `CLOUDINARY_API_SECRET`     | from Cloudinary                                                |
| `SENTRY_DSN`                | from Sentry                                                    |
| `SENTRY_ENVIRONMENT`        | `production`                                                   |
| `TRUSTED_PROXY_HOPS`        | `1`                                                            |
| `WHATSAPP_SENDER`           | `deep-link`                                                    |

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

Copy the **External** database URL from Render's Postgres page, then on your laptop:

```bash
psql "<external owner URL>" -v app_password=choose-a-strong-password -f scripts/db-roles.sql
```

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
