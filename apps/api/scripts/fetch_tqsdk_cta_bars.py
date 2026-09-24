"""Fetch completed CTA bars from TqSdk and upsert them into the local database."""

import argparse
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.core.config import settings
from app.db.session import Base, SessionLocal, engine
from app.models.cta import ContractInfo, MarketBar


TQ_SYMBOLS = {
    "P2701": "DCE.p2701",
    "OI2701": "CZCE.OI701",
    "Y2701": "DCE.y2701",
}
TIMEFRAMES = {
    "D1": (86_400, 61),
    "H1": (3_600, 241),
    "M30": (1_800, 241),
}


def utc_naive(timestamp_ns: Any) -> datetime:
    return datetime.fromtimestamp(int(timestamp_ns) / 1_000_000_000, tz=timezone.utc).replace(tzinfo=None)


def value_at(row: Any, *names: str, default: int | float = 0) -> int | float:
    for name in names:
        value = row.get(name) if hasattr(row, "get") else None
        if value is not None:
            return value
    return default


def upsert_bars(contract_code: str, bars_by_timeframe: dict[str, list[dict[str, Any]]], expiry_timestamp: Any = None) -> int:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        contract = db.scalar(select(ContractInfo).where(ContractInfo.contract == contract_code))
        if contract is None:
            raise ValueError(f"CTA contract is not configured: {contract_code}")
        if expiry_timestamp and int(expiry_timestamp) > 0:
            contract.last_trade_date = utc_naive(expiry_timestamp).date()

        count = 0
        for timeframe, bars in bars_by_timeframe.items():
            for bar in bars:
                close_time = utc_naive(bar["datetime"])
                values = {
                    "open": float(bar["open"]),
                    "high": float(bar["high"]),
                    "low": float(bar["low"]),
                    "close": float(bar["close"]),
                    "volume": int(value_at(bar, "volume")),
                    "open_interest": int(value_at(bar, "close_oi", "open_interest")) or None,
                    "is_final": True,
                    "source": "TQSDK",
                    "source_time": datetime.utcnow(),
                }
                stored = db.scalar(select(MarketBar).where(
                    MarketBar.contract_id == contract.id,
                    MarketBar.timeframe == timeframe,
                    MarketBar.close_time == close_time,
                ))
                if stored is None:
                    db.add(MarketBar(contract_id=contract.id, timeframe=timeframe, close_time=close_time, **values))
                else:
                    for key, value in values.items():
                        setattr(stored, key, value)
                count += 1
        db.commit()
        return count
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def fetch_contract(contract_code: str, timeout_seconds: int) -> int:
    if not settings.tqsdk_user or not settings.tqsdk_password:
        raise RuntimeError("Missing TQSDK_USER or TQSDK_PASSWORD in apps/api/.env")
    if contract_code not in TQ_SYMBOLS:
        raise ValueError(f"Unsupported beta contract: {contract_code}")

    from tqsdk import TqApi, TqAuth

    api = TqApi(auth=TqAuth(settings.tqsdk_user, settings.tqsdk_password))
    try:
        serials = {
            timeframe: api.get_kline_serial(TQ_SYMBOLS[contract_code], duration_seconds=seconds, data_length=length)
            for timeframe, (seconds, length) in TIMEFRAMES.items()
        }
        quote = api.get_quote(TQ_SYMBOLS[contract_code])
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            api.wait_update(deadline=min(deadline, time.time() + 5))
            if all(int(serial.iloc[-2]["datetime"]) > 0 for serial in serials.values()):
                break
        else:
            raise TimeoutError(
                f"Timed out after {timeout_seconds}s waiting for TqSdk bars. "
                "Check TqSdk market-data permission and proxy connectivity."
            )
        bars_by_timeframe: dict[str, list[dict[str, Any]]] = {}
        for timeframe, serial in serials.items():
            # The last row can still be forming; it must never participate in a CTA decision.
            rows = [row.to_dict() for _, row in serial.iloc[:-1].iterrows() if int(row["datetime"]) > 0]
            if not rows:
                raise RuntimeError(f"TqSdk returned no completed {timeframe} bars for {TQ_SYMBOLS[contract_code]}")
            bars_by_timeframe[timeframe] = rows
        return upsert_bars(contract_code, bars_by_timeframe, getattr(quote, "expire_datetime", None))
    finally:
        api.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch completed D1/H1/M30 CTA bars from TqSdk. No orders are submitted.")
    parser.add_argument("--contracts", nargs="+", choices=sorted(TQ_SYMBOLS), default=sorted(TQ_SYMBOLS))
    parser.add_argument("--timeout", type=int, default=90, help="Maximum seconds to wait for each contract's initial data.")
    args = parser.parse_args()
    for contract in args.contracts:
        print(f"{contract}: fetching {TQ_SYMBOLS[contract]} ...", flush=True)
        print(f"{contract}: upserted {fetch_contract(contract, args.timeout)} completed bars")
