from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "tirupati_jewelles",
    broker=settings.redis_url,
    include=["app.tasks.fetch_gold_rate", "app.tasks.cleanup_gold_rates"],
)
celery_app.conf.timezone = "Asia/Kolkata"


celery_app.conf.beat_schedule = {
    "fetch-gold-rate-daily-9am": {
        "task": "fetch_gold_rate",
        "schedule": crontab(hour=9, minute=0),
    },
    "cleanup-gold-rates-weekly": {
        "task": "cleanup_gold_rates",
        "schedule": crontab(hour=9, minute=0, day_of_week=1),
    },
}
