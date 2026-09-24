from datetime import date, datetime

from pydantic import BaseModel, Field


class LiveQuoteOut(BaseModel):
    variety: str
    name: str
    contract: str
    exchange: str
    sector: str = "自选"
    instrument_type: str = "ACTUAL"
    tq_symbol: str | None = None
    trading_day: str | None = None
    price_source: str = "UNAVAILABLE"
    timeframe: str
    last_price: float | None
    change: float | None
    change_percent: float | None
    volume: int | None
    open_interest: int | None
    open_interest_change: int | None
    quote_time: str | None
    status: str
    price_points: list["PricePointOut"]
    oi_points: list["OiPointOut"]
    bars: list["MarketBarOut"] = Field(default_factory=list)
    daily_bars: list["MarketBarOut"] = Field(default_factory=list)


class PricePointOut(BaseModel):
    time: str
    price: float


class OiPointOut(BaseModel):
    time: str
    open_interest: int
    change: int


class MarketBarOut(BaseModel):
    time: str
    open: float | None
    high: float | None
    low: float | None
    close: float
    volume: int | None
    open_interest: int | None
    oi_change: int | None = None
    is_closed: bool


class LiveQuotesOut(BaseModel):
    source: str
    fetched_at: datetime
    cache_age_seconds: float | None
    connection_error: str | None = None
    timeframe: str
    timeframe_label: str
    data_mode: str
    quotes: list[LiveQuoteOut]


class TerminalQuoteOut(BaseModel):
    source: str
    fetched_at: datetime
    cache_age_seconds: float | None
    connection_error: str | None = None
    timeframe: str
    timeframe_label: str
    data_mode: str
    quote: LiveQuoteOut


class WatchlistQuoteOut(BaseModel):
    contract: str
    last_price: float | None
    change_percent: float | None
    quote_time: str | None
    status: str


class WatchlistQuotesOut(BaseModel):
    source: str
    fetched_at: datetime
    cache_age_seconds: float | None
    connection_error: str | None = None
    data_mode: str
    quotes: list[WatchlistQuoteOut]


class PanoramaQuoteOut(BaseModel):
    variety: str
    name: str
    contract: str
    exchange: str
    sector: str
    tq_symbol: str
    trading_day: str | None
    last_price: float | None
    day_change_percent: float | None
    five_day_change_percent: float | None
    price_history: list[float]
    quote_time: str | None
    price_source: str
    status: str


class PanoramaQuotesOut(BaseModel):
    source: str
    fetched_at: datetime
    cache_age_seconds: float | None
    connection_error: str | None = None
    data_mode: str
    universe_name: str
    universe_size: int
    quotes: list[PanoramaQuoteOut]


class TrendPointOut(BaseModel):
    date: str
    close: float
    volume: int
    open_interest: int


class TrendInstrumentOut(BaseModel):
    variety: str
    name: str
    contract: str
    exchange: str
    sector: str
    direction: str
    short_direction: str
    setup_state: str
    classification: str
    data_quality: str
    is_steady: bool
    volume_rising: bool
    open_interest_rising: bool
    volume_signal: str
    open_interest_signal: str
    volume_relative_to_average: float | None
    open_interest_relative_to_average: float | None
    three_day_return: float | None
    volume_growth: float | None
    open_interest_growth: float | None
    volume_baseline: float | None
    open_interest_baseline: float | None
    range_percent: float | None
    stability_score: int | None
    trend_score: int | None
    score_breakdown: dict[str, int]
    evidence: list[str]
    warnings: list[str]
    points: list[TrendPointOut]


class TrendTrackerOut(BaseModel):
    source: str
    fetched_at: datetime
    cache_age_seconds: float | None
    data_mode: str
    connection_error: str | None = None
    universe_name: str
    universe_size: int
    commodity_count: int
    excluded_chemical_count: int
    excluded_varieties: list[str]
    rubber_exceptions: list[str]
    sector_counts: dict[str, int]
    lookback_days: int
    completed_only: bool
    instruments: list[TrendInstrumentOut]


class TrendBacktestSymbolOut(BaseModel):
    variety: str
    name: str
    contract: str
    exchange: str
    sector: str


class TrendBacktestSymbolsOut(BaseModel):
    source: str
    fetched_at: datetime
    data_mode: str
    history_days: int
    symbols: list[TrendBacktestSymbolOut]


class TrendBacktestDatesOut(BaseModel):
    variety: str
    dates: list[date]


class TrendBacktestPerformanceOut(BaseModel):
    horizon_trading_days: int
    exit_date: date | None
    raw_return_percent: float | None
    directional_return_percent: float | None
    outcome: str


class TrendBacktestStatOut(BaseModel):
    sample_count: int
    win_rate: float | None
    average_directional_return: float | None


class TrendBacktestHorizonOut(BaseModel):
    horizon_trading_days: int
    price_structure: TrendBacktestStatOut
    volume_oi_confirmed: TrendBacktestStatOut


class TrendBacktestSummaryOut(BaseModel):
    variety: str
    name: str
    from_date: date | None
    to_date: date | None
    observations: int
    price_structure_count: int
    volume_oi_confirmed_count: int
    horizons: list[TrendBacktestHorizonOut]


class TrendBacktestOut(BaseModel):
    source: str
    fetched_at: datetime
    data_mode: str
    variety: str
    name: str
    contract: str
    sector: str
    as_of_date: date
    signal_active: bool
    signal: TrendInstrumentOut
    performance: list[TrendBacktestPerformanceOut]
