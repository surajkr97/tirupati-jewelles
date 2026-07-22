from datetime import datetime, timedelta, timezone

from app.database import SessionLocal
from app.models.gold_rate import GoldRate


def run():
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        deleted = db.query(GoldRate).filter(GoldRate.recorded_at < cutoff).delete()
        db.commit()
        print(f"Deleted {deleted} gold rate rows older than 7 days.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
