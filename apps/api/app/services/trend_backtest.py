"""Historical validation for the same price-volume-open-interest trend rules."""

from __future__ import annotations

from datetime import date
from statistics import mean
from typing import Any

from app.services.tqsdk_market import fetch_trend_history, finite_float, finite_int
from app.services.trend_tracker import analyze_instrument


MIN_HISTORY_BARS = 25
HORIZONS = (1, 3, 5)


def _as_date(bar: dict[str, Any]) -> date:
    return date.fromisoformat(str(bar["time"])[:10])


def _bars(quote: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for bar in quote.get("daily_bars", []):
        if not bar.get("is_closed"):
            continue
        if finite_float(bar.get("close")) is None or finite_int(bar.get("volume")) is None or finite_int(bar.get("open_interest")) is None:
            continue
        result.append(bar)
    return result


def _quote(snapshot: dict[str, Any], variety: str) -> dict[str, Any]:
    row = next((item for item in snapshot.get("quotes", []) if item.get("variety") == variety.upper()), None)
    if row is None:
        raise ValueError(f"Trend history is unavailable for {variety.upper()}")
    return row


def _eligible_indexes(bars: list[dict[str, Any]]) -> list[int]:
    return [
        index
        for index in range(MIN_HISTORY_BARS - 1, len(bars) - max(HORIZONS))
    ]


def _analysis_at(quote: dict[str, Any], bars: list[dict[str, Any]], index: int) -> dict[str, Any]:
    return analyze_instrument({**quote, "daily_bars": bars[: index + 1]})


def _forward_return(bars: list[dict[str, Any]], index: int, horizon: int, direction: str | None = None) -> tuple[float, date]:
    entry = float(bars[index]["close"])
    exit_bar = bars[index + horizon]
    raw_return = round((float(exit_bar["close"]) / entry - 1) * 100, 2)
    if direction == "DOWN":
        raw_return = -raw_return
    return raw_return, _as_date(exit_bar)


def backtest_symbols() -> dict[str, Any]:
    snapshot = fetch_trend_history()
    return {
        "source": snapshot["source"],
        "fetched_at": snapshot["fetched_at"],
        "data_mode": snapshot["data_mode"],
        "history_days": snapshot.get("history_days", 0),
        "symbols": [
            {key: quote[key] for key in ("variety", "name", "contract", "exchange", "sector")}
            for quote in snapshot.get("quotes", [])
        ],
    }


def backtest_dates(variety: str) -> dict[str, Any]:
    quote = _quote(fetch_trend_history(), variety)
    bars = _bars(quote)
    return {"variety": quote["variety"], "dates": [_as_date(bars[index]) for index in _eligible_indexes(bars)]}


def backtest_at(variety: str, as_of: date) -> dict[str, Any]:
    snapshot = fetch_trend_history()
    quote = _quote(snapshot, variety)
    bars = _bars(quote)
    index = next((offset for offset, bar in enumerate(bars) if _as_date(bar) == as_of), None)
    if index is None or index not in _eligible_indexes(bars):
        raise ValueError(f"{quote['variety']} has no eligible trend backtest snapshot on {as_of.isoformat()}")
    signal = _analysis_at(quote, bars, index)
    signal_active = (
        signal["classification"] in {"CONFIRMED_STEADY_UP", "CONFIRMED_STEADY_DOWN"}
        and signal["trend_score"] >= 60
    )
    performance = []
    for horizon in HORIZONS:
        raw_return, exit_date = _forward_return(bars, index, horizon)
        directional_return, _ = _forward_return(bars, index, horizon, signal["direction"])
        outcome = "NOT_TRIGGERED"
        if signal_active:
            outcome = "WIN" if directional_return > 0 else "LOSS" if directional_return < 0 else "FLAT"
        performance.append({
            "horizon_trading_days": horizon,
            "exit_date": exit_date,
            "raw_return_percent": raw_return,
            "directional_return_percent": directional_return if signal_active else None,
            "outcome": outcome,
        })
    return {
        "source": snapshot["source"],
        "fetched_at": snapshot["fetched_at"],
        "data_mode": snapshot["data_mode"],
        **{key: quote[key] for key in ("variety", "name", "contract", "sector")},
        "as_of_date": as_of,
        "signal_active": signal_active,
        "signal": signal,
        "performance": performance,
    }


def _stat(returns: list[float]) -> dict[str, Any]:
    if not returns:
        return {"sample_count": 0, "win_rate": None, "average_directional_return": None}
    return {
        "sample_count": len(returns),
        "win_rate": round(sum(item > 0 for item in returns) / len(returns) * 100, 1),
        "average_directional_return": round(mean(returns), 2),
    }


def backtest_summary(variety: str) -> dict[str, Any]:
    quote = _quote(fetch_trend_history(), variety)
    bars = _bars(quote)
    indexes = _eligible_indexes(bars)
    analyses = [(index, _analysis_at(quote, bars, index)) for index in indexes]
    price_structure = [
        item for item in analyses
        if item[1]["setup_state"] == "CONTINUATION" and item[1]["direction"] in {"UP", "DOWN"}
    ]
    confirmed = [
        item for item in analyses
        if item[1]["classification"] in {"CONFIRMED_STEADY_UP", "CONFIRMED_STEADY_DOWN"} and item[1]["trend_score"] >= 60
    ]
    horizons = []
    for horizon in HORIZONS:
        horizons.append({
            "horizon_trading_days": horizon,
            "price_structure": _stat([_forward_return(bars, index, horizon, result["direction"])[0] for index, result in price_structure]),
            "volume_oi_confirmed": _stat([_forward_return(bars, index, horizon, result["direction"])[0] for index, result in confirmed]),
        })
    return {
        "variety": quote["variety"],
        "name": quote["name"],
        "from_date": _as_date(bars[indexes[0]]) if indexes else None,
        "to_date": _as_date(bars[indexes[-1]]) if indexes else None,
        "observations": len(indexes),
        "price_structure_count": len(price_structure),
        "volume_oi_confirmed_count": len(confirmed),
        "horizons": horizons,
    }
