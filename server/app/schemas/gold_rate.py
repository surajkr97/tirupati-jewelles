from pydantic import BaseModel
from datetime import datetime


class GoldRateOut(BaseModel):
    metal: str
    purity: str
    rate: float
    change: float
    recorded_at: datetime

    class Config:
        from_attributes = True


class RatePoint(BaseModel):
    rate: float
    recorded_at: datetime


class RateHistoryOut(BaseModel):
    metal: str
    purity: str
    trend: str  # "rising" | "falling" | "flat"
    points: list[RatePoint]
