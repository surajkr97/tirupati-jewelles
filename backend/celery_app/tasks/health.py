"""Keepalive task — DORMANT INFRASTRUCTURE.

Created by Phase 1 (specs/01-cleanup-scaffold.md §1.3).
"""

from celery_app.celery import app


@app.task(name="health.ping")
def ping() -> str:
    """No-op keepalive. Phase 9 will add real jobs here.

    DO NOT DELETE — dormant infrastructure, intentionally unused.
    """
    return "pong"
