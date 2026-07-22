from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.gold_rate import GoldRateOut
from app.services.rate_service import get_live_rates

from app.schemas.gold_rate import RateHistoryOut
from app.services.rate_service import get_rate_history

router = APIRouter(prefix="/rates", tags=["rates"])


@router.get("/live", response_model=list[GoldRateOut])
def read_live_rates(db: Session = Depends(get_db)):
    return get_live_rates(db)


@router.get("/history", response_model=RateHistoryOut)
def read_rate_history(
    metal: str, purity: str, hours: int = 24, db: Session = Depends(get_db)
):
    return get_rate_history(db, metal, purity, hours)
