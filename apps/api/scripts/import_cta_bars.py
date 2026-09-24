import argparse
import csv
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from app.db.session import Base, SessionLocal, engine
from app.models.cta import ContractInfo, MarketBar

REQUIRED_FIELDS = {"contract", "timeframe", "close_time", "open", "high", "low", "close", "volume"}
VALID_TIMEFRAMES = {"D1", "H1", "M30"}


def parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)


def import_bars(path: Path) -> int:
    Base.metadata.create_all(bind=engine)
    with path.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    if not rows or not REQUIRED_FIELDS.issubset(rows[0]):
        raise ValueError(f"CSV requires columns: {', '.join(sorted(REQUIRED_FIELDS))}")
    db = SessionLocal()
    try:
        count = 0
        for raw in rows:
            contract_code = raw["contract"].strip().upper()
            contract = db.scalar(select(ContractInfo).where(ContractInfo.contract == contract_code))
            if contract is None:
                raise ValueError(f"Unknown CTA contract: {contract_code}")
            timeframe = raw["timeframe"].strip().upper()
            if timeframe not in VALID_TIMEFRAMES:
                raise ValueError(f"Invalid timeframe: {timeframe}")
            close_time = parse_datetime(raw["close_time"])
            values = {
                "open": float(raw["open"]), "high": float(raw["high"]), "low": float(raw["low"]), "close": float(raw["close"]),
                "volume": int(raw["volume"]), "open_interest": int(raw["open_interest"]) if raw.get("open_interest") else None,
                "is_final": raw.get("is_final", "true").strip().lower() in {"1", "true", "yes"},
                "source": raw.get("source", "CSV").strip() or "CSV", "source_time": parse_datetime(raw["source_time"]) if raw.get("source_time") else datetime.utcnow(),
            }
            if values["low"] > min(values["open"], values["close"]) or values["high"] < max(values["open"], values["close"]):
                raise ValueError(f"Invalid OHLC range: {contract_code} {close_time.isoformat()}")
            row = db.scalar(select(MarketBar).where(MarketBar.contract_id == contract.id, MarketBar.timeframe == timeframe, MarketBar.close_time == close_time))
            if row is None:
                db.add(MarketBar(contract_id=contract.id, timeframe=timeframe, close_time=close_time, **values))
            else:
                for key, value in values.items():
                    setattr(row, key, value)
            count += 1
        db.commit()
        return count
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import final CTA D1/H1/M30 bars without generating trading orders.")
    parser.add_argument("csv_path", type=Path)
    args = parser.parse_args()
    print(f"Imported {import_bars(args.csv_path)} CTA bars")
