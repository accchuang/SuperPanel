"""Standalone TqSdk worker that continuously writes durable market snapshots."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings
from app.services.tqsdk_market import LIVE_INSTRUMENTS, TIMEFRAMES, build_market_quote


def write_snapshots(output_dir: Path, serials: dict[str, list[tuple[dict[str, str], object]]], quotes: list[object]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).isoformat()
    for timeframe, items in serials.items():
        built = [build_market_quote(instrument, serial, quote, timeframe) for (instrument, serial), quote in zip(items, quotes)]
        payload = {
            "source": "TQSDK",
            "fetched_at": fetched_at,
            "cache_age_seconds": 0.0,
            "connection_error": None,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAMES[timeframe]["label"],
            "data_mode": "LIVE" if any(item["status"] == "LIVE" for item in built) else "STATIC",
            "quotes": built,
        }
        target = output_dir / f"{timeframe}.json"
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, target)


def main(output_dir: Path) -> None:
    if not settings.tqsdk_user or not settings.tqsdk_password:
        raise RuntimeError("TQSDK_USER or TQSDK_PASSWORD is not configured")
    from tqsdk import TqApi, TqAuth

    api = TqApi(auth=TqAuth(settings.tqsdk_user, settings.tqsdk_password))
    try:
        quotes = [api.get_quote(instrument["tq_symbol"]) for instrument in LIVE_INSTRUMENTS]
        serials = {
            timeframe: [
                (instrument, api.get_kline_serial(
                    instrument["tq_symbol"],
                    duration_seconds=config["seconds"],
                    data_length=config["data_length"],
                ))
                for instrument in LIVE_INSTRUMENTS
            ]
            for timeframe, config in TIMEFRAMES.items()
        }
        # A deadline is required after close: no new tick may arrive to release an unrestricted wait.
        api.wait_update(deadline=time.time() + 10)
        write_snapshots(output_dir, serials, quotes)
        while True:
            api.wait_update(deadline=time.time() + 5)
            write_snapshots(output_dir, serials, quotes)
    finally:
        api.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    main(args.output_dir)
