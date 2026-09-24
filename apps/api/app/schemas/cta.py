from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

NodeStatus = Literal["PASS", "WARNING", "FAIL", "UNKNOWN"]
Direction = Literal["LONG", "SHORT", "NEUTRAL", "UNKNOWN"]


class ContractOut(BaseModel):
    variety: str
    contract: str
    exchange: str
    multiplier: float
    tick_size: float
    first_notice_date: date | None
    last_trade_date: date | None
    margin_rate: float
    limit_ratio: float
    is_active: bool


class ContractConfigIn(BaseModel):
    variety: str = Field(min_length=1, max_length=20)
    contract: str = Field(min_length=1, max_length=20)
    exchange: str = Field(min_length=1, max_length=20)
    multiplier: float = Field(gt=0)
    tick_size: float = Field(gt=0)
    first_notice_date: date | None = None
    last_trade_date: date | None = None
    margin_rate: float = Field(default=0, ge=0, le=1)
    limit_ratio: float = Field(default=0, ge=0, le=1)
    is_active: bool = True


class BarIn(BaseModel):
    contract: str
    timeframe: Literal["D1", "H1", "M30"]
    close_time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int = Field(ge=0)
    open_interest: int | None = Field(default=None, ge=0)
    is_final: bool = True
    source: str = "CSV"


class DecisionNodeResult(BaseModel):
    node_name: str
    status: NodeStatus
    score: float | None = None
    direction: Direction = "UNKNOWN"
    positive_evidence: list[str] = Field(default_factory=list)
    negative_evidence: list[str] = Field(default_factory=list)
    missing_conditions: list[str] = Field(default_factory=list)
    raw_metrics: dict[str, Any] = Field(default_factory=dict)
    conclusion: str
    data_quality: Literal["COMPLETE", "PARTIAL", "STALE", "INVALID"]


class TrendAnalysisOut(BaseModel):
    direction: Direction
    score: float | None
    stage: str
    metrics: dict[str, float | str | None]


class PositionStructureAnalysisOut(BaseModel):
    direction: Direction
    score: float | None
    metrics: dict[str, float | int | str | None]


class EntrySetupAnalysisOut(BaseModel):
    direction: Direction
    score: float | None
    pattern: str | None
    entry_price: float | None
    stop_price: float | None
    target_price: float | None
    rr_ratio: float | None


class RiskAnalysisOut(BaseModel):
    score: float | None
    flags: list[str]
    metrics: dict[str, float | int | str | None]


class DecisionReportOut(BaseModel):
    id: str | None = None
    contract: str
    variety: str
    generated_at: datetime
    snapshot_time: datetime | None
    rule_version: str
    direction: Direction
    trend_stage: str
    trend_score: float | None
    structure_score: float | None
    entry_score: float | None
    risk_score: float | None
    system_state: str
    data_quality: str
    blocking_reasons: list[str]
    warnings: list[str]
    nodes: list[DecisionNodeResult]
    trend: TrendAnalysisOut | None = None
    structure: PositionStructureAnalysisOut | None = None
    entry: EntrySetupAnalysisOut | None = None
    risk: RiskAnalysisOut | None = None
    summary: str


class BacktestDatesOut(BaseModel):
    contract: str
    dates: list[date]


class ForwardPerformanceOut(BaseModel):
    horizon_trading_days: int
    exit_date: date | None
    entry_price: float
    exit_price: float | None
    raw_return_percent: float | None
    directional_return_percent: float | None
    outcome: Literal["WIN", "LOSS", "FLAT", "NOT_TRIGGERED", "UNKNOWN"]


class HistoricalBacktestOut(BaseModel):
    contract: str
    variety: str
    as_of_date: date
    report: DecisionReportOut
    performance: list[ForwardPerformanceOut]


class HumanDecisionIn(BaseModel):
    operator: str = "local"
    decision: Literal["TRADE", "SKIP", "WATCH"]
    side: Literal["LONG", "SHORT"] | None = None
    note: str = Field(default="", max_length=1000)


class HumanDecisionOut(BaseModel):
    id: int
    report_id: str
    operator: str
    decision: str
    side: str | None
    note: str
    decided_at: datetime
