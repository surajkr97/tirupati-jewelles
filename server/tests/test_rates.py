# server/tests/test_rates.py
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from app.models.gold_rate import GoldRate
from app.services.rate_service import get_live_rates, refresh_gold_rates

IST = timezone(timedelta(hours=5, minutes=30))

def test_get_live_rates(client, db_session):
    now = datetime.now(timezone.utc)
    db_session.add(
        GoldRate(metal_type="gold", purity="999", rate_per_gram=6000, recorded_at=now)
    )
    db_session.add(
        GoldRate(metal_type="gold", purity="916", rate_per_gram=5500, recorded_at=now)
    )
    db_session.add(
        GoldRate(metal_type="gold", purity="750", rate_per_gram=4500, recorded_at=now)
    )
    db_session.add(
        GoldRate(metal_type="gold", purity="585", rate_per_gram=3500, recorded_at=now)
    )
    db_session.add(
        GoldRate(metal_type="silver", purity="999", rate_per_gram=80, recorded_at=now)
    )
    db_session.commit()

    response = client.get("/rates/live")
    assert response.status_code == 200

    data = response.json()
    assert len(data) == 5

    first = data[0]
    assert "metal" in first
    assert "purity" in first
    assert "rate" in first
    assert "change" in first


def test_change_calculation(db_session):
    now_ist = datetime.now(IST)
    yesterday_time = now_ist - timedelta(days=1)  # guaranteed before "start of today"
    today_time = now_ist  # guaranteed on/after "start of today"

    db_session.add(
        GoldRate(
            metal_type="gold",
            purity="916",
            rate_per_gram=6000,
            recorded_at=yesterday_time,
        )
    )
    db_session.add(
        GoldRate(
            metal_type="gold",
            purity="916",
            rate_per_gram=6100,
            recorded_at=today_time,
        )
    )
    db_session.commit()

    results = get_live_rates(db_session)
    gold_916 = next(r for r in results if r.purity == "916")
    # rate_per_gram rose by 100, gold displays per 10 grams -> change shown as 1000
    assert gold_916.change == 1000


def test_refresh_gold_rates_saves_data(db_session):
    fake_rates = [
        {
            "metal": "gold",
            "pure_rate_per_gram": 7000.0,
            "recorded_at": datetime.now(timezone.utc),
        },
        {
            "metal": "silver",
            "pure_rate_per_gram": 85.0,
            "recorded_at": datetime.now(timezone.utc),
        },
    ]

    with patch(
        "app.services.rate_service.GoldApiAdapter.fetch_all_rates",
        return_value=fake_rates,
    ):
        rows = refresh_gold_rates(db_session)

    assert len(rows) == 5  # 4 gold purities + 1 silver purity
    saved = db_session.query(GoldRate).all()
    assert len(saved) == 5