from datetime import date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ContractInfo(Base):
    __tablename__ = "cta_contracts"
    __table_args__ = (UniqueConstraint("contract", name="uq_cta_contract"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    variety: Mapped[str] = mapped_column(String(20), index=True)
    contract: Mapped[str] = mapped_column(String(20), index=True)
    exchange: Mapped[str] = mapped_column(String(20))
    multiplier: Mapped[float] = mapped_column(Float)
    tick_size: Mapped[float] = mapped_column(Float)
    first_notice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_trade_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    margin_rate: Mapped[float] = mapped_column(Float, default=0.0)
    limit_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MarketBar(Base):
    __tablename__ = "cta_market_bars"
    __table_args__ = (UniqueConstraint("contract_id", "timeframe", "close_time", name="uq_cta_bar_contract_timeframe_close"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("cta_contracts.id"), index=True)
    timeframe: Mapped[str] = mapped_column(String(8), index=True)  # D1, H1, M30
    close_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    open: Mapped[float] = mapped_column(Numeric(18, 6))
    high: Mapped[float] = mapped_column(Numeric(18, 6))
    low: Mapped[float] = mapped_column(Numeric(18, 6))
    close: Mapped[float] = mapped_column(Numeric(18, 6))
    volume: Mapped[int] = mapped_column(Integer)
    open_interest: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_final: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String(40), default="CSV")
    source_time: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DecisionReport(Base):
    __tablename__ = "cta_decision_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    contract_id: Mapped[int] = mapped_column(ForeignKey("cta_contracts.id"), index=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    rule_version: Mapped[str] = mapped_column(String(40))
    snapshot_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    direction: Mapped[str] = mapped_column(String(12))
    trend_stage: Mapped[str] = mapped_column(String(20))
    trend_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    structure_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    entry_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    system_state: Mapped[str] = mapped_column(String(32), index=True)
    data_quality: Mapped[str] = mapped_column(String(20))
    blocking_reasons: Mapped[list[str]] = mapped_column(JSON, default=list)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    nodes: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    summary: Mapped[str] = mapped_column(Text)


class HumanDecision(Base):
    __tablename__ = "cta_human_decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[str] = mapped_column(ForeignKey("cta_decision_reports.id"), index=True)
    operator: Mapped[str] = mapped_column(String(80), default="local")
    decision: Mapped[str] = mapped_column(String(12))  # TRADE, SKIP, WATCH
    side: Mapped[str | None] = mapped_column(String(12), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    decided_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
