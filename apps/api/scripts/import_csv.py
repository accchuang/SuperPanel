import argparse
import csv
from datetime import date
from pathlib import Path

from sqlalchemy import delete

from app.db.session import Base, SessionLocal, engine
from app.models.position import RawPosition


def parse_int(value: str) -> int:
    return int(value.replace(",", "").strip())


def import_csv(path: Path, replace: bool = False) -> int:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if replace:
            db.execute(delete(RawPosition))
        count = 0
        with path.open(newline="", encoding="utf-8") as file:
            reader = csv.DictReader(file)
            for row in reader:
                db.merge(
                    RawPosition(
                        trade_date=date.fromisoformat(row["date"]),
                        symbol=row["symbol"].strip().upper(),
                        broker=row["broker"].strip(),
                        long_position=parse_int(row["long_position"]),
                        long_change=parse_int(row["long_change"]),
                        short_position=parse_int(row["short_position"]),
                        short_change=parse_int(row["short_change"]),
                        rank=parse_int(row["rank"]),
                    )
                )
                count += 1
        db.commit()
        return count
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    imported = import_csv(args.csv_path, args.replace)
    print(f"Imported {imported} rows from {args.csv_path}")
