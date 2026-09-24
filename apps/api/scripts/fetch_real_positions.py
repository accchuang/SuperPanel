import argparse
import csv
import inspect
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests


SYMBOL_EXCHANGE = {
    "A": "DCE",
    "AG": "SHFE",
    "AL": "SHFE",
    "AO": "SHFE",
    "AP": "CZCE",
    "AU": "SHFE",
    "C": "DCE",
    "CF": "CZCE",
    "CS": "DCE",
    "CU": "SHFE",
    "HC": "SHFE",
    "I": "DCE",
    "J": "DCE",
    "JD": "DCE",
    "JM": "DCE",
    "M": "DCE",
    "NI": "SHFE",
    "OI": "CZCE",
    "P": "DCE",
    "PB": "SHFE",
    "PK": "CZCE",
    "RB": "SHFE",
    "RM": "CZCE",
    "SF": "CZCE",
    "SM": "CZCE",
    "SN": "SHFE",
    "SR": "CZCE",
    "Y": "DCE",
    "ZN": "SHFE",
}

EXCHANGE_FUNCTIONS = {
    "DCE": ["futures_dce_position_rank", "get_dce_rank_table"],
    "CZCE": ["get_rank_table_czce", "get_czce_rank_table"],
    "SHFE": ["get_shfe_rank_table"],
}

EASTMONEY_MARKET_CODES = {
    "DCE": "069001007",
    "CZCE": "069001008",
    "SHFE": "069001005",
}

CSV_FIELDS = [
    "date",
    "symbol",
    "broker",
    "long_position",
    "long_change",
    "short_position",
    "short_change",
    "rank",
]


def parse_yyyymmdd(value: str) -> date:
    return datetime.strptime(value, "%Y%m%d").date()


def trading_days(start: date, end: date) -> list[date]:
    days: list[date] = []
    current = start
    while current <= end:
        if current.weekday() < 5:
            days.append(current)
        current += timedelta(days=1)
    return days


def to_int(value: Any) -> int:
    if value is None:
        return 0
    text = str(value).replace(",", "").strip()
    if text in {"", "-", "nan", "None"}:
        return 0
    return int(float(text))


def clean_broker(value: Any) -> str:
    if value is None:
        return ""
    cleaned = str(value).replace("(代客)", "").replace("（代客）", "").strip()
    if cleaned in {"合计", "总计", "总量增减", "本日合计", "上日合计", "前五席位", "前十席位", "前二十席位", "nan"}:
        return ""
    return cleaned


def root_symbol(value: Any) -> str:
    match = re.match(r"([A-Za-z]+)", str(value).strip())
    return match.group(1).upper() if match else str(value).strip().upper()


def pick_column(columns: list[str], candidates: list[str]) -> str | None:
    normalized = {column.lower(): column for column in columns}
    for candidate in candidates:
        if candidate.lower() in normalized:
            return normalized[candidate.lower()]
    for column in columns:
        if any(candidate in column for candidate in candidates):
            return column
    return None


def call_akshare(ak: Any, exchange: str, trade_date: date, symbols: list[str]) -> Any:
    last_error: Exception | None = None
    for function_name in EXCHANGE_FUNCTIONS[exchange]:
        function = getattr(ak, function_name, None)
        if function is None:
            continue
        try:
            kwargs: dict[str, Any] = {"date": trade_date.strftime("%Y%m%d")}
            parameters = inspect.signature(function).parameters
            if "vars_list" in parameters:
                kwargs["vars_list"] = symbols
            return function(**kwargs)
        except TypeError:
            try:
                return function(trade_date.strftime("%Y%m%d"))
            except Exception as exc:
                last_error = exc
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Failed to fetch {exchange} {trade_date}: {last_error}")


def iter_frames(payload: Any) -> list[Any]:
    if isinstance(payload, dict):
        return [frame for frame in payload.values() if frame is not None and not frame.empty]
    if payload is not None and hasattr(payload, "empty") and not payload.empty:
        return [payload]
    return []


def normalize_payload(payload: Any, wanted_symbols: set[str], trade_date: date) -> list[dict[str, Any]]:
    import pandas as pd

    broker_book: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"long_position": 0, "long_change": 0, "short_position": 0, "short_change": 0}
    )

    for frame in iter_frames(payload):
        df = pd.DataFrame(frame).copy()
        columns = [str(column) for column in df.columns]
        df.columns = columns

        variety_col = pick_column(columns, ["variety", "品种", "品种代码"])
        contract_col = pick_column(columns, ["symbol", "合约", "合约代码"])
        long_party_col = pick_column(columns, ["long_party_name", "持买单量会员简称", "多头会员简称", "多头期货公司会员简称"])
        long_position_col = pick_column(columns, ["long_open_interest", "持买单量", "多头持仓", "多头持仓量"])
        long_change_col = pick_column(columns, ["long_open_interest_chg", "持买单量-增减", "多头增减"])
        short_party_col = pick_column(columns, ["short_party_name", "持卖单量会员简称", "空头会员简称", "空头期货公司会员简称"])
        short_position_col = pick_column(columns, ["short_open_interest", "持卖单量", "空头持仓", "空头持仓量"])
        short_change_col = pick_column(columns, ["short_open_interest_chg", "持卖单量-增减", "空头增减"])

        if not long_party_col or not long_position_col or not short_party_col or not short_position_col:
            continue

        for _, row in df.iterrows():
            symbol = ""
            if variety_col:
                symbol = root_symbol(row.get(variety_col))
            if not symbol and contract_col:
                symbol = root_symbol(row.get(contract_col))
            if symbol not in wanted_symbols:
                continue

            long_broker = clean_broker(row.get(long_party_col))
            if long_broker and long_broker not in {"合计", "总计", "nan"}:
                key = (symbol, long_broker)
                broker_book[key]["long_position"] += to_int(row.get(long_position_col))
                broker_book[key]["long_change"] += to_int(row.get(long_change_col)) if long_change_col else 0

            short_broker = clean_broker(row.get(short_party_col))
            if short_broker and short_broker not in {"合计", "总计", "nan"}:
                key = (symbol, short_broker)
                broker_book[key]["short_position"] += to_int(row.get(short_position_col))
                broker_book[key]["short_change"] += to_int(row.get(short_change_col)) if short_change_col else 0

    rows = []
    by_symbol: dict[str, list[tuple[str, dict[str, int]]]] = defaultdict(list)
    for (symbol, broker), values in broker_book.items():
        by_symbol[symbol].append((broker, values))

    for symbol, brokers in by_symbol.items():
        ranked = sorted(
            brokers,
            key=lambda item: item[1]["long_position"] + item[1]["short_position"],
            reverse=True,
        )[:20]
        for rank, (broker, values) in enumerate(ranked, start=1):
            rows.append(
                {
                    "date": trade_date.isoformat(),
                    "symbol": symbol,
                    "broker": broker,
                    "long_position": values["long_position"],
                    "long_change": values["long_change"],
                    "short_position": values["short_position"],
                    "short_change": values["short_change"],
                    "rank": rank,
                }
            )
    return rows


def fetch_eastmoney_dce(symbols: list[str], trade_date: date) -> list[dict[str, Any]]:
    """Fetch complete symbol batches; failed retries must never contribute partial rows."""
    rows: list[dict[str, Any]] = []
    endpoint = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    request_session = requests.Session()
    request_session.trust_env = False
    for symbol in symbols:
        filter_expression = (
            f'(TRADE_MARKET_CODE="{EASTMONEY_MARKET_CODES[SYMBOL_EXCHANGE[symbol]]}")'
            f'(TRADE_CODE="{symbol}")'
            f"(TRADE_DATE='{trade_date.isoformat()}')"
        )
        for attempt in range(1, 4):
            try:
                batch = []
                page = 1
                while True:
                    params = {
                        "reportName": "RPT_FUTU_DAILYPOSITION",
                        "columns": "ALL",
                        "filter": filter_expression,
                        "sortColumns": "SECURITY_CODE,ORG_CODE",
                        "sortTypes": "1,1",
                        "pageNumber": page,
                        "pageSize": 200,
                        "source": "WEB",
                        "client": "WEB",
                    }
                    response = request_session.get(endpoint, params=params, timeout=45)
                    response.raise_for_status()
                    payload = response.json()
                    if not payload.get("success"):
                        raise requests.RequestException(str(payload.get("message", "Upstream error")))
                    result = payload.get("result") or {}
                    page_rows = result.get("data") or []
                    for item in page_rows:
                        batch.append(
                            {
                                "date": trade_date.isoformat(),
                                "symbol": symbol,
                                "broker": clean_broker(item.get("ORG_NAME_ABBR_NEW") or item.get("MEMBER_NAME_ABBR")),
                                "long_position": to_int(item.get("LONG_POSITION")),
                                "long_change": to_int(item.get("LP_CHANGE")),
                                "short_position": to_int(item.get("SHORT_POSITION")),
                                "short_change": to_int(item.get("SP_CHANGE")),
                            }
                        )
                    pages = int(result.get("pages") or page)
                    if page >= pages or not page_rows:
                        break
                    page += 1
                rows.extend(batch)
                break
            except requests.RequestException as exc:
                if attempt == 3:
                    raise RuntimeError(f"Eastmoney {symbol} {trade_date} failed after 3 attempts") from exc

    broker_book: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"long_position": 0, "long_change": 0, "short_position": 0, "short_change": 0}
    )
    for row in rows:
        broker = row["broker"]
        if not broker or broker in {"合计", "总计", "nan"}:
            continue
        values = broker_book[(row["symbol"], broker)]
        for field in ("long_position", "long_change", "short_position", "short_change"):
            values[field] += row[field]

    normalized: list[dict[str, Any]] = []
    by_symbol: dict[str, list[tuple[str, dict[str, int]]]] = defaultdict(list)
    for (symbol, broker), values in broker_book.items():
        by_symbol[symbol].append((broker, values))
    for symbol, brokers in by_symbol.items():
        ranked = sorted(
            brokers,
            key=lambda item: item[1]["long_position"] + item[1]["short_position"],
            reverse=True,
        )[:20]
        for rank, (broker, values) in enumerate(ranked, start=1):
            normalized.append({"date": trade_date.isoformat(), "symbol": symbol, "broker": broker, "rank": rank, **values})
    return normalized


def fetch_positions(symbols: list[str], days: list[date], source: str = "auto") -> list[dict[str, Any]]:
    import akshare as ak

    all_rows: list[dict[str, Any]] = []
    symbols_by_exchange: dict[str, list[str]] = defaultdict(list)
    for symbol in symbols:
        exchange = SYMBOL_EXCHANGE.get(symbol)
        if not exchange:
            raise ValueError(f"Unsupported symbol: {symbol}")
        symbols_by_exchange[exchange].append(symbol)

    for trade_date in days:
        if source == "eastmoney":
            rows = fetch_eastmoney_dce(symbols, trade_date)
            if {row["symbol"] for row in rows} != set(symbols):
                raise ValueError(f"Incomplete data for {trade_date}; no database changes made")
            all_rows.extend(rows)
            print(f"[info] {trade_date}: {len(rows)} rows", flush=True)
            continue
        for exchange, exchange_symbols in symbols_by_exchange.items():
            try:
                payload = call_akshare(ak, exchange, trade_date, exchange_symbols)
            except Exception as exc:
                print(f"[warn] {exchange} {trade_date}: {exc}")
                payload = None
            rows = normalize_payload(payload, set(exchange_symbols), trade_date)
            if not rows and exchange == "DCE":
                try:
                    rows = fetch_eastmoney_dce(exchange_symbols, trade_date)
                    print(f"[info] using Eastmoney fallback for DCE {trade_date} symbols={','.join(exchange_symbols)}")
                except Exception as fallback_exc:
                    print(f"[warn] Eastmoney DCE fallback failed for {trade_date}: {fallback_exc}")
            if not rows:
                print(f"[warn] no rows normalized for {exchange} {trade_date} symbols={','.join(exchange_symbols)}")
            all_rows.extend(rows)
    return sorted(all_rows, key=lambda row: (row["date"], row["symbol"], row["rank"]))


def write_csv(rows: list[dict[str, Any]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def import_and_compute(csv_path: Path, symbols: list[str], replace_symbols: bool = False) -> None:
    from app.db.session import Base, SessionLocal, engine
    from app.models.position import RawPosition
    from app.services.features import rebuild_features
    from sqlalchemy import delete

    with csv_path.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    csv_symbols = {row["symbol"].strip().upper() for row in rows}
    if not rows or csv_symbols != set(symbols):
        raise ValueError("Import requires nonempty data for every requested symbol")
    for row in rows:
        if not clean_broker(row["broker"]) or any(int(row[field]) < 0 for field in ("long_position", "short_position")):
            raise ValueError(f"Invalid position row: {row['date']} {row['symbol']} {row['broker']}")

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if replace_symbols:
            db.execute(delete(RawPosition).where(RawPosition.symbol.in_(csv_symbols)))
        else:
            for day, symbol in {(row["date"], row["symbol"]) for row in rows}:
                db.execute(delete(RawPosition).where(RawPosition.symbol == symbol, RawPosition.trade_date == date.fromisoformat(day)))
        for row in rows:
            db.add(RawPosition(trade_date=date.fromisoformat(row["date"]), symbol=row["symbol"], broker=row["broker"],
                **{field: int(row[field]) for field in CSV_FIELDS[3:]}))
        db.flush()
        imported = len(rows)
        features = rebuild_features(db)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    print(f"Imported {imported} rows and rebuilt {features} feature rows")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch real futures position rank data and normalize it to project CSV schema.")
    parser.add_argument("--date", help="Single trade date, e.g. 20260904")
    parser.add_argument("--start", help="Start trade date, e.g. 20260901")
    parser.add_argument("--end", help="End trade date, e.g. 20260904")
    parser.add_argument("--symbols", nargs="+", default=list(SYMBOL_EXCHANGE.keys()), help="Variety symbols, e.g. RB CU M Y")
    parser.add_argument("--output", type=Path, default=Path("../../data/real_positions.csv"))
    parser.add_argument("--import-db", action="store_true", help="Import CSV into raw_positions and rebuild position_features after fetching.")
    parser.add_argument("--source", choices=["auto", "eastmoney"], default="auto")
    parser.add_argument("--replace-symbols", action="store_true", help="Explicitly replace all history for requested symbols (e.g. removing mock data).")
    args = parser.parse_args()

    if args.date:
        days = [parse_yyyymmdd(args.date)]
    elif args.start and args.end:
        days = trading_days(parse_yyyymmdd(args.start), parse_yyyymmdd(args.end))
    else:
        raise SystemExit("Provide --date or both --start and --end")

    symbols = [symbol.upper() for symbol in args.symbols]
    rows = fetch_positions(symbols, days, args.source)
    write_csv(rows, args.output)
    print(f"Wrote {len(rows)} rows to {args.output}")
    if args.import_db:
        import_and_compute(args.output, symbols, args.replace_symbols)


if __name__ == "__main__":
    main()
