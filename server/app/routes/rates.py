from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database import get_db
from app.schemas.gold_rate import GoldRateOut, RateHistoryOut
from app.services.rate_service import (
    get_live_rates,
    get_rate_history,
    refresh_gold_rates,
)

router = APIRouter(prefix="/rates", tags=["rates"])


@router.get("/live", response_model=list[GoldRateOut])
def read_live_rates(db: Session = Depends(get_db)):
    return get_live_rates(db)


@router.get("/history", response_model=RateHistoryOut)
def read_rate_history(
    metal: str, purity: str, hours: int = 168, db: Session = Depends(get_db)
):
    return get_rate_history(db, metal, purity, hours)


@router.post("/internal/refresh")
def trigger_refresh(x_refresh_key: str = Header(...), db: Session = Depends(get_db)):
    if x_refresh_key != settings.refresh_secret_key:
        raise HTTPException(status_code=403, detail="Forbidden")
    rows = refresh_gold_rates(db)
    return {"status": "ok", "rows_saved": len(rows)}
