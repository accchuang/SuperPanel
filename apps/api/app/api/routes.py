from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import distinct, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.position import RawPosition
from app.schemas.position import DatesOut, OverviewOut, StrengthOut, SummaryOut, SymbolOut
from app.schemas.market import (
    LiveQuotesOut,
    TerminalQuoteOut,
    WatchlistQuotesOut,
    PanoramaQuotesOut,
    TrendBacktestDatesOut,
    TrendBacktestOut,
    TrendBacktestSummaryOut,
    TrendBacktestSymbolsOut,
    TrendTrackerOut,
)
from app.services.analysis import get_leaderboard, get_overview, get_strength, get_summary, get_trend

router = APIRouter()


@router.get("/market/live", response_model=LiveQuotesOut)
def live_market(timeframe: str = Query("5m")):
    from app.services.tqsdk_market import TIMEFRAMES, fetch_live_quotes

    if timeframe not in TIMEFRAMES:
        raise HTTPException(status_code=422, detail="timeframe must be one of: " + ", ".join(TIMEFRAMES))
    try:
        return fetch_live_quotes(timeframe)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"TqSdk 行情暂不可用：{exc}") from exc


@router.get("/market/terminal", response_model=TerminalQuoteOut)
def market_terminal(contract: str = Query(...), timeframe: str = Query("5m")):
    from app.services.tqsdk_market import TIMEFRAMES, fetch_terminal_quote

    if timeframe not in TIMEFRAMES:
        raise HTTPException(status_code=422, detail="timeframe must be one of: " + ", ".join(TIMEFRAMES))
    try:
        return fetch_terminal_quote(contract, timeframe)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"TqSdk 行情暂不可用：{exc}") from exc


@router.get("/market/watchlist", response_model=WatchlistQuotesOut)
def market_watchlist():
    from app.services.tqsdk_market import fetch_watchlist_quotes

    try:
        return fetch_watchlist_quotes()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"TqSdk 行情暂不可用：{exc}") from exc


@router.get("/market/panorama", response_model=PanoramaQuotesOut)
def market_panorama():
    from app.services.tqsdk_market import fetch_panorama_quotes

    try:
        return fetch_panorama_quotes()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"全市场价格快照暂不可用：{exc}") from exc


@router.get("/market/trends", response_model=TrendTrackerOut)
def market_trends():
    from app.services.trend_tracker import fetch_trend_tracker

    try:
        return fetch_trend_tracker()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"趋势快照暂不可用：{exc}") from exc


@router.get("/market/trends/backtest/symbols", response_model=TrendBacktestSymbolsOut)
def trend_backtest_symbols():
    from app.services.trend_backtest import backtest_symbols

    try:
        return backtest_symbols()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"趋势历史暂不可用：{exc}") from exc


@router.get("/market/trends/backtest/dates", response_model=TrendBacktestDatesOut)
def trend_backtest_dates(variety: str = Query(...)):
    from app.services.trend_backtest import backtest_dates

    try:
        return backtest_dates(variety)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/market/trends/backtest", response_model=TrendBacktestOut)
def trend_backtest(variety: str = Query(...), as_of: date = Query(...)):
    from app.services.trend_backtest import backtest_at

    try:
        return backtest_at(variety, as_of)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/market/trends/backtest/summary", response_model=TrendBacktestSummaryOut)
def trend_backtest_summary(variety: str = Query(...)):
    from app.services.trend_backtest import backtest_summary

    try:
        return backtest_summary(variety)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/evolution")
def evolution(
    symbol: str = Query(...),
    start: date | None = None,
    end: date | None = None,
    days: int = Query(30, ge=1, le=120),
    db: Session = Depends(get_db),
):
    from app.services.evolution import get_evolution

    if start and end and start > end:
        raise HTTPException(status_code=422, detail="start must not exceed end")
    return get_evolution(db, symbol, start, end, days)


@router.get("/symbols", response_model=SymbolOut)
def symbols(db: Session = Depends(get_db)):
    rows = db.scalars(select(distinct(RawPosition.symbol)).order_by(RawPosition.symbol)).all()
    return {"symbols": rows}


@router.get("/dates", response_model=DatesOut)
def dates(symbol: str | None = None, db: Session = Depends(get_db)):
    stmt = select(distinct(RawPosition.trade_date))
    if symbol:
        stmt = stmt.where(RawPosition.symbol == symbol)
    rows = db.scalars(stmt.order_by(RawPosition.trade_date.desc())).all()
    return {"dates": rows, "latest": rows[0] if rows else None}


@router.get("/overview", response_model=OverviewOut)
def overview(symbol: str = Query(...), date_: date | None = Query(None, alias="date"), db: Session = Depends(get_db)):
    try:
        return get_overview(db, symbol, date_)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/leaderboard")
def leaderboard(
    symbol: str = Query(...),
    date_: date | None = Query(None, alias="date"),
    limit: int = Query(50, ge=1, le=50),
    db: Session = Depends(get_db),
):
    try:
        rows = get_leaderboard(db, symbol, date_, limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return [
        {
            "broker": row.broker,
            "rank": row.rank,
            "long_position": row.long_position,
            "long_change": row.long_change,
            "short_position": row.short_position,
            "short_change": row.short_change,
            "net_position": row.net_position,
            "net_change": row.net_change,
            "consecutive_long_add_days": row.consecutive_long_add_days,
            "consecutive_long_reduce_days": row.consecutive_long_reduce_days,
        }
        for row in rows
    ]


@router.get("/trend")
def trend(
    symbol: str = Query(...),
    date_: date | None = Query(None, alias="date"),
    days: int = Query(30, ge=5, le=120),
    db: Session = Depends(get_db),
):
    try:
        return get_trend(db, symbol, date_, days=days)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/strength", response_model=StrengthOut)
def strength(symbol: str = Query(...), date_: date | None = Query(None, alias="date"), db: Session = Depends(get_db)):
    try:
        return get_strength(db, symbol, date_)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/summary", response_model=SummaryOut)
def summary(symbol: str = Query(...), date_: date | None = Query(None, alias="date"), db: Session = Depends(get_db)):
    try:
        return get_summary(db, symbol, date_)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
