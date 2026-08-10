# `celery_app/` — dormant infrastructure

**This code intentionally does nothing. Do not delete it.**

If you are an agent, a linter, a dead-code tool, or a contributor tidying up: this package
looks unused because it _is_ unused, on purpose. It is not an oversight and it is not a
leftover.

## Why it is here

`specs/01-cleanup-scaffold.md` §1.3 requires the Celery + Redis setup be retained through the
rebuild:

> Deleting it and re-adding it later costs more than leaving it running as a no-op. Do not
> remove it, and do not let a linter or dead-code tool remove it either.

Keeping a worker that genuinely connects to a broker and runs in `docker-compose` means the
broker URL, the container, the health check and the compose wiring are all proven working
_before_ anything depends on them. Reintroducing that later, under deadline, while also
writing the first real task, is how async infrastructure gets shipped broken.

## What is in it

| File              | Contents                                                                                        |
| :---------------- | :---------------------------------------------------------------------------------------------- |
| `celery.py`       | The Celery app: Redis broker + result backend, `Asia/Kolkata` timezone, an empty beat schedule. |
| `tasks/health.py` | One task, `health.ping`, which returns `"pong"`. That is the whole of it.                       |

## Phase 9 did NOT activate it, and that is a decision — D-042

§9.3 was reached and the jobs were built. **They run in Node, not here**, and this package is
still dormant on purpose. Read D-042 before "finishing" the migration below; the short
version:

Three of §9.3's five tasks are TypeScript by their nature, not by accident.
`bills.generate_pdf` renders through `@react-pdf/renderer` — React components,
`lib/pricing.ts`, Prisma — so a Python worker would need a **second invoice implementation**,
which §8 forbids outright ("Three implementations of GST rounding is three different totals
on the same purchase, and the customer will find it"). `notify.retry_failed` posts to Resend
from `lib/notify/`. `media.process_image` drives Cloudinary from TypeScript. The remaining
two are pure SQL and Python could do them — but this container has only `REDIS_URL`, no
database access at all, and splitting five jobs across two queue technologies to use both
would be worse than either.

So the queue is `lib/queue/` on BullMQ, against the same Redis, and the worker is
`pnpm worker` (`scripts/worker.mts`).

**This package stays exactly as it is.** MASTER-SPEC §2 and AGENTS.md both forbid deleting
it, the compose service still runs, and `health.ping` still proves the broker wiring. If a
job ever appears that is genuinely Python-shaped — an ML model, a PDF toolchain with no Node
equivalent — the infrastructure is still here and still connected, which was the original
argument for keeping it.

## What was originally planned for it — superseded by D-042

`specs/09-hardening.md` §9.3 activates it:

- `bills.generate_pdf` — move PDF rendering off the request path
- `rates.rollup_history` — nightly rate history → daily candles for the sparkline
- `media.process_image` — resize, convert, generate blur placeholders
- `notify.retry_failed` — retry queue for failed SMS/email
- `cleanup.expire_shares` — remove expired calculator share links

Every one of those must degrade gracefully when the worker is down — PDF generation falls
back to synchronous rendering. **A dead worker must never mean a dead billing feature.**

## Verifying it is alive

```bash
docker compose up -d redis worker
docker compose logs worker | grep ready          # → "celery@... ready."
docker compose exec worker python -c \
  "from celery_app.tasks.health import ping; print(ping.delay().get(timeout=10))"
# → pong
```

## History

Relocated from `server/app/celery_app.py` during the Phase 1 rebuild. The broker config
survived; the two `beat_schedule` entries did not — they drove the gold-rate fetch and cleanup
tasks, which were deleted with the live-price API. See `specs/INVENTORY.md`.
