"""Price-only market panorama built from actual dominant commodity contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.services.tqsdk_market import (
    daily_bar_is_closed,
    finite_float,
    finite_int,
    quote_datetime,
    quote_is_live,
    quote_time_text,
    timestamp_datetime,
    trading_day_for_datetime,
)


def build_panorama_quote(instrument: dict[str, str], serial: Any, quote: Any, *, now: datetime | None = None) -> dict[str, Any]:
    """Five price transitions use six daily observations; an active day uses the live quote."""
    current = now or datetime.now()
    rows = [row for _, row in serial.iterrows() if finite_int(row.get("datetime"))]
    completed = []
    for row in rows:
        close = finite_float(row.get("close"))
        if close is None or close <= 0 or not daily_bar_is_closed(row.get("datetime"), now=current):
            continue
        row_time = timestamp_datetime(row.get("datetime"))
        if row_time:
            completed.append((trading_day_for_datetime(row_time).isoformat(), close))

    quoted_price = finite_float(getattr(quote, "last_price", None))
    if quoted_price is not None and quoted_price <= 0:
        quoted_price = None
    fallback_price = finite_float(rows[-1].get("close")) if rows else None
    last_price = quoted_price if quoted_price is not None else fallback_price
    quote_time = quote_datetime(getattr(quote, "datetime", None))
    last_row_time = timestamp_datetime(rows[-1].get("datetime")) if rows else None
    trading_day = trading_day_for_datetime(quote_time or last_row_time).isoformat() if quote_time or last_row_time else None

    history = [close for _, close in completed[-6:]]
    if last_price is not None and trading_day and (not completed or completed[-1][0] != trading_day):
        history = [close for _, close in completed[-5:]] + [last_price]
    history = history[-6:]
    five_day_change = round((history[-1] / history[0] - 1) * 100, 3) if len(history) == 6 and history[0] > 0 else None

    previous_close = finite_float(getattr(quote, "pre_close", None))
    day_change = round((last_price / previous_close - 1) * 100, 3) if last_price is not None and previous_close and previous_close > 0 else None
    return {
        **{key: instrument[key] for key in ("variety", "name", "contract", "exchange", "sector", "tq_symbol")},
        "trading_day": trading_day,
        "last_price": last_price,
        "day_change_percent": day_change,
        "five_day_change_percent": five_day_change,
        "price_history": history,
        "quote_time": quote_time_text(getattr(quote, "datetime", None)) if quote_time else None,
        "price_source": "QUOTE" if quoted_price is not None else "BAR_CLOSE" if last_price is not None else "UNAVAILABLE",
        "status": "LIVE" if quoted_price is not None and quote_is_live(getattr(quote, "datetime", None), now=current) else "CLOSED",
    }
