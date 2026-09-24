from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class RawPosition(Base):
    __tablename__ = "raw_positions"
    __table_args__ = (
        UniqueConstraint("date", "symbol", "broker", "rank", name="uq_raw_position_day_symbol_broker_rank"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date] = mapped_column("date", Date, index=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    broker: Mapped[str] = mapped_column(String(120), index=True)
    long_position: Mapped[int] = mapped_column(Integer)
    long_change: Mapped[int] = mapped_column(Integer)
    short_position: Mapped[int] = mapped_column(Integer)
    short_change: Mapped[int] = mapped_column(Integer)
    rank: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PositionFeature(Base):
    __tablename__ = "position_features"
    __table_args__ = (
        UniqueConstraint("date", "symbol", "broker", name="uq_position_feature_day_symbol_broker"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trade_date: Mapped[date] = mapped_column("date", Date, index=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    broker: Mapped[str] = mapped_column(String(120), index=True)
    rank: Mapped[int] = mapped_column(Integer)
    long_position: Mapped[int] = mapped_column(Integer)
    long_change: Mapped[int] = mapped_column(Integer)
    short_position: Mapped[int] = mapped_column(Integer)
    short_change: Mapped[int] = mapped_column(Integer)
    net_position: Mapped[int] = mapped_column(Integer)
    net_change: Mapped[int] = mapped_column(Integer)
    long_ratio: Mapped[Decimal] = mapped_column(Numeric(12, 6))
    short_ratio: Mapped[Decimal] = mapped_column(Numeric(12, 6))
    top5_concentration: Mapped[Decimal] = mapped_column(Numeric(12, 6))
    top10_concentration: Mapped[Decimal] = mapped_column(Numeric(12, 6))
    consecutive_long_add_days: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_long_reduce_days: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_short_add_days: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_short_reduce_days: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
