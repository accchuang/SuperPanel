"""Collect a compact, all-commodity price snapshot for the market panorama."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings
from app.services.price_panorama import build_panorama_quote
from app.services.tqsdk_market import TIMEFRAMES, discover_commodity_universe


PANORAMA_DAILY_BARS = 26


def write_snapshot(output_dir: Path, items: list[tuple[dict[str, str], object, object]]) -> None:
    built = [build_panorama_quote(instrument, serial, quote) for instrument, serial, quote in items]
    payload = {
        "source": "TQSDK",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "data_mode": "LIVE" if any(item["status"] == "LIVE" for item in built) else "STATIC",
        "universe_name": "国内商品主力",
        "universe_size": len(built),
        "quotes": built,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / "panorama-1d.json"
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, target)


def main(output_dir: Path) -> None:
    if not settings.tqsdk_user or not settings.tqsdk_password:
        raise RuntimeError("TQSDK_USER or TQSDK_PASSWORD is not configured")
    from tqsdk import TqApi, TqAuth

    api = TqApi(auth=TqAuth(settings.tqsdk_user, settings.tqsdk_password))
    try:
        instruments = discover_commodity_universe(api)
        items = [
            (
                instrument,
                api.get_kline_serial(instrument["tq_symbol"], duration_seconds=TIMEFRAMES["1d"]["seconds"], data_length=PANORAMA_DAILY_BARS),
                api.get_quote(instrument["tq_symbol"]),
            )
            for instrument in instruments
        ]
        api.wait_update(deadline=time.time() + 15)
        write_snapshot(output_dir, items)
        next_write = time.monotonic() + 15
        while True:
            api.wait_update(deadline=time.time() + 5)
            if time.monotonic() >= next_write:
                write_snapshot(output_dir, items)
                next_write = time.monotonic() + 15
    finally:
        api.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    main(args.output_dir)
