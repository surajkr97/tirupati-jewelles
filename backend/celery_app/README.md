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

## What will go in it — Phase 9, not before

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
