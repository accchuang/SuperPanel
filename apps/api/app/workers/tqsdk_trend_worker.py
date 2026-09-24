"""Collect daily bars for the filtered domestic commodity dominant universe."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings
from app.services.tqsdk_market import (
    RUBBER_VARIETIES,
    TIMEFRAMES,
    build_market_quote,
    continuous_symbol_for_instrument,
    daily_bar_is_closed,
    discover_trend_universe,
    finite_float,
    finite_int,
    timestamp_text,
)


HISTORY_DAYS = 120
# Keep one forming bar plus 25 completed bars for MA20 and its five-day slope.
TREND_CONTEXT_DAYS = 26


def serial_is_ready(serial: object) -> bool:
    try:
        return finite_float(serial.iloc[-1]["close"]) is not None
    except (AttributeError, IndexError, KeyError):
        return False


def write_snapshot(
    output_dir: Path,
    items: list[tuple[dict[str, str], object, object]],
    excluded: list[str],
    *,
    write_history: bool = False,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    built = [
        build_market_quote(instrument, serial, quote, "1d", daily_bar_limit=TREND_CONTEXT_DAYS)
        for instrument, serial, quote in items
    ]
    payload = {
        "source": "TQSDK",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cache_age_seconds": 0.0,
        "connection_error": None,
        "timeframe": "1d",
        "timeframe_label": TIMEFRAMES["1d"]["label"],
        "data_mode": "LIVE" if any(item["status"] == "LIVE" for item in built) else "STATIC",
        "universe_name": "国内商品主力",
        "universe_size": len(built),
        "commodity_count": len(built) + len(excluded),
        "excluded_chemical_count": len(excluded),
        "excluded_varieties": excluded,
        "rubber_exceptions": sorted(RUBBER_VARIETIES),
        "quotes": built,
    }
    target = output_dir / "trend-1d.json"
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, target)
    if write_history:
        history_quotes = []
        for instrument, serial, _ in items:
            bars = []
            for _, row in serial.iterrows():
                timestamp = row.get("datetime")
                if not finite_int(timestamp) or not daily_bar_is_closed(timestamp):
                    continue
                close = finite_float(row.get("close"))
                volume = finite_int(row.get("volume"))
                open_interest = finite_int(row.get("close_oi"))
                if close is None or volume is None or open_interest is None:
                    continue
                bars.append({
                    "time": timestamp_text(timestamp),
                    "open": finite_float(row.get("open")),
                    "high": finite_float(row.get("high")),
                    "low": finite_float(row.get("low")),
                    "close": close,
                    "volume": volume,
                    "open_interest": open_interest,
                    "is_closed": True,
                })
            history_quotes.append({
                **{key: instrument[key] for key in ("variety", "name", "contract", "exchange", "sector")},
                "continuous_symbol": continuous_symbol_for_instrument(instrument),
                "daily_bars": bars,
            })
        history_payload = {
            "source": "TQSDK",
            "fetched_at": payload["fetched_at"],
            "data_mode": payload["data_mode"],
            "history_days": HISTORY_DAYS,
            "quotes": history_quotes,
        }
        history_target = output_dir / "trend-history-1d.json"
        history_temporary = history_target.with_suffix(".tmp")
        history_temporary.write_text(json.dumps(history_payload, ensure_ascii=False), encoding="utf-8")
        os.replace(history_temporary, history_target)


def main(output_dir: Path) -> None:
    if not settings.tqsdk_user or not settings.tqsdk_password:
        raise RuntimeError("TQSDK_USER or TQSDK_PASSWORD is not configured")
    from tqsdk import TqApi, TqAuth

    api = TqApi(auth=TqAuth(settings.tqsdk_user, settings.tqsdk_password))
    try:
        instruments, excluded = discover_trend_universe(api)
        items = [
            (
                instrument,
                api.get_kline_serial(
                    continuous_symbol_for_instrument(instrument),
                    duration_seconds=TIMEFRAMES["1d"]["seconds"],
                    data_length=HISTORY_DAYS,
                ),
                api.get_quote(instrument["tq_symbol"]),
            )
            for instrument in instruments
        ]
        initialization_deadline = time.time() + 30
        while time.time() < initialization_deadline:
            api.wait_update(deadline=min(time.time() + 2, initialization_deadline))
            if all(serial_is_ready(serial) for _, serial, _ in items):
                break
        write_snapshot(output_dir, items, excluded, write_history=True)

        next_write = time.monotonic() + 15
        while True:
            api.wait_update(deadline=time.time() + 5)
            if time.monotonic() >= next_write:
                write_snapshot(output_dir, items, excluded)
                next_write = time.monotonic() + 15
    finally:
        api.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    main(args.output_dir)
