from sqlalchemy import Column, Integer, String, Numeric, DateTime, Index
from sqlalchemy.sql import func
from app.database import Base


class GoldRate(Base):
    __tablename__ = "gold_rates"

    id = Column(Integer, primary_key=True, index=True)
    metal_type = Column(String, nullable=False)
    purity = Column(String, nullable=False)
    rate_per_gram = Column(Numeric(10, 4), nullable=False)
    recorded_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    source = Column(String, nullable=True)

    __table_args__ = (
        Index("ix_gold_rate_lookup", "metal_type", "purity", "recorded_at"),
    )
