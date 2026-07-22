from app.database import SessionLocal
from app.services.rate_service import refresh_gold_rates

def run():
    db = SessionLocal()
    try:
        rows = refresh_gold_rates(db)
        print(f"Saved {len(rows)} gold rate rows.")
    finally:
        db.close()

if __name__ == "__main__":
    run()