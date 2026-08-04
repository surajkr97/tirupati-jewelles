"""Celery application — DORMANT INFRASTRUCTURE.

Created by Phase 1 (specs/01-cleanup-scaffold.md §1.3).

This worker connects to Redis and runs, but does no application work. It exists so
that Phase 9 (specs/09-hardening.md §9.3) can move real jobs onto a broker that is
already configured, already in docker-compose, and already proven to connect.

DO NOT DELETE. DO NOT BUILD FEATURES ON IT YET. See README.md in this directory.
"""

import os

from celery import Celery

# ASSUMPTION: the Node side owns config validation (lib/env.ts, Zod, throws at boot).
# Duplicating that schema in Python would give us two sources of truth for one .env,
# so this reads the one variable it needs and fails loudly if it is absent.
REDIS_URL = os.environ.get("REDIS_URL")
if not REDIS_URL:
    raise RuntimeError(
        "REDIS_URL is not set. The Celery worker cannot start without a broker. "
        "Copy .env.example to .env at the repo root."
    )

app = Celery(
    "tirupati_jewelles",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["celery_app.tasks.health"],
)

app.conf.timezone = "Asia/Kolkata"

# Deliberately empty. Phase 9 adds the periodic entries for rates.rollup_history
# and cleanup.expire_shares. The pre-rebuild schedule pointed at gold-rate fetch
# tasks that Phase 1 deleted along with the live-price API (INVENTORY.md).
app.conf.beat_schedule = {}
