from sqlalchemy.orm import Session

from app.adapters.gold_api_adapter import GoldApiAdapter
from app.models.gold_rate import GoldRate
from app.schemas.gold_rate import GoldRateOut

from datetime import datetime, timedelta, timezone
from app.schemas.gold_rate import RatePoint, RateHistoryOut

from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))

GOLD_PURITIES = {
    "999": 0.999,  # 24K
    "916": 0.916,  # 22K
    "750": 0.750,  # 18K
    "585": 0.585,  # 14K
}

SILVER_PURITIES = {
    "999": 0.999,
}


def refresh_gold_rates(db: Session) -> list[GoldRate]:
    """
    Fetches live pure rates from the adapter, fans them out into
    per-purity GoldRate rows, saves them, and returns the saved rows.
    """
    adapter = GoldApiAdapter()
    raw_rates = adapter.fetch_all_rates()  # [{gold dict}, {silver dict}]

    new_rows = []

    for raw in raw_rates:
        metal = raw["metal"]
        pure_rate = raw["pure_rate_per_gram"]
        recorded_at = raw["recorded_at"]

        purities = GOLD_PURITIES if metal == "gold" else SILVER_PURITIES

        for purity_label, fraction in purities.items():
            row = GoldRate(
                metal_type=metal,
                purity=purity_label,
                rate_per_gram=pure_rate * fraction,
                recorded_at=recorded_at,
                source="gold-api.com",
            )
            db.add(row)
            new_rows.append(row)

    db.commit()

    for row in new_rows:
        db.refresh(row)

    return new_rows


DISPLAY_UNITS = {
    "gold": 10,
    "silver": 1000,
}


# def get_live_rates(db: Session) -> list[GoldRateOut]:
#     combos = [("gold", p) for p in GOLD_PURITIES] + [
#         ("silver", p) for p in SILVER_PURITIES
#     ]
#     results = []

#     for metal, purity in combos:
#         rows = (
#             db.query(GoldRate)
#             .filter(GoldRate.metal_type == metal, GoldRate.purity == purity)
#             .order_by(GoldRate.recorded_at.desc())
#             .limit(2)
#             .all()
#         )

#         if not rows:
#             continue

#         latest = rows[0]
#         previous = rows[1] if len(rows) > 1 else None

#         multiplier = DISPLAY_UNITS[metal]
#         rate_display = float(latest.rate_per_gram) * multiplier
#         change_display = (
#             float(latest.rate_per_gram - previous.rate_per_gram) * multiplier
#             if previous
#             else 0.0
#         )

#         results.append(
#             GoldRateOut(
#                 metal=metal,
#                 purity=purity,
#                 rate=round(rate_display),
#                 change=round(change_display),
#                 recorded_at=latest.recorded_at,
#             )
#         )

#     return results


def get_live_rates(db: Session) -> list[GoldRateOut]:
    combos = [("gold", p) for p in GOLD_PURITIES] + [
        ("silver", p) for p in SILVER_PURITIES
    ]
    results = []

    now_ist = datetime.now(IST)
    start_of_today = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)

    for metal, purity in combos:
        latest = (
            db.query(GoldRate)
            .filter(GoldRate.metal_type == metal, GoldRate.purity == purity)
            .order_by(GoldRate.recorded_at.desc())
            .first()
        )
        if not latest:
            continue

        yesterday_close = (
            db.query(GoldRate)
            .filter(
                GoldRate.metal_type == metal,
                GoldRate.purity == purity,
                GoldRate.recorded_at < start_of_today,
            )
            .order_by(GoldRate.recorded_at.desc())
            .first()
        )

        multiplier = DISPLAY_UNITS[metal]
        rate_display = float(latest.rate_per_gram) * multiplier
        change_display = (
            float(latest.rate_per_gram - yesterday_close.rate_per_gram) * multiplier
            if yesterday_close
            else 0.0
        )

        results.append(
            GoldRateOut(
                metal=metal,
                purity=purity,
                rate=round(rate_display),
                change=round(change_display),
                recorded_at=latest.recorded_at,
            )
        )
    return results


def get_rate_history(
    db: Session, metal: str, purity: str, hours: int = 24
) -> RateHistoryOut:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    rows = (
        db.query(GoldRate)
        .filter(
            GoldRate.metal_type == metal,
            GoldRate.purity == purity,
            GoldRate.recorded_at >= since,
        )
        .order_by(GoldRate.recorded_at.asc())
        .all()
    )

    multiplier = DISPLAY_UNITS[metal]
    points = [
        RatePoint(
            rate=round(float(row.rate_per_gram) * multiplier, 4),
            recorded_at=row.recorded_at,
        )
        for row in rows
    ]

    if len(points) >= 2:
        if points[-1].rate > points[0].rate:
            trend = "rising"
        elif points[-1].rate < points[0].rate:
            trend = "falling"
        else:
            trend = "flat"
    else:
        trend = "flat"

    return RateHistoryOut(metal=metal, purity=purity, trend=trend, points=points)
