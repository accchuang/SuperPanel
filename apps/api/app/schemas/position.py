from datetime import date

from pydantic import BaseModel


class SymbolOut(BaseModel):
    symbols: list[str]


class DatesOut(BaseModel):
    dates: list[date]
    latest: date | None


class OverviewOut(BaseModel):
    symbol: str
    date: date
    long_change: int
    short_change: int
    oi_change: int
    net_change: int
    long_short_score: float
    trend_state: str
    top5_concentration: float
    top10_concentration: float


class LeaderboardRow(BaseModel):
    broker: str
    rank: int
    long_position: int
    long_change: int
    short_position: int
    short_change: int
    net_position: int
    net_change: int
    consecutive_long_add_days: int
    consecutive_long_reduce_days: int


class TrendPoint(BaseModel):
    date: date
    broker: str
    net_position: int
    long_change: int
    short_change: int


class BrokerTrend(BaseModel):
    broker: str
    points: list[TrendPoint]


class StrengthOut(BaseModel):
    long: int
    short: int
    net: int
    net_long: int
    net_short: int


class SummaryOut(BaseModel):
    symbol: str
    date: date
    summary: str
