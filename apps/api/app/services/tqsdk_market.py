"""Persistent TqSdk snapshots for the live-market screen."""

from __future__ import annotations

import json
import math
import re
import subprocess
import sys
import threading
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any

from app.core.config import settings


LIVE_INSTRUMENTS = (
    {"variety": "P", "name": "棕榈油", "contract": "P2701", "exchange": "DCE", "sector": "油脂油料", "tq_symbol": "DCE.p2701"},
    {"variety": "OI", "name": "菜籽油", "contract": "OI2701", "exchange": "CZCE", "sector": "油脂油料", "tq_symbol": "CZCE.OI701"},
    {"variety": "Y", "name": "豆油", "contract": "Y2701", "exchange": "DCE", "sector": "油脂油料", "tq_symbol": "DCE.y2701"},
    {"variety": "LH", "name": "生猪", "contract": "LH2611", "exchange": "DCE", "sector": "农产品", "tq_symbol": "DCE.lh2611"},
    {"variety": "JD", "name": "鸡蛋", "contract": "JD2611", "exchange": "DCE", "sector": "农产品", "tq_symbol": "DCE.jd2611"},
    {"variety": "SR", "name": "白糖", "contract": "SR2701", "exchange": "CZCE", "sector": "农产品", "tq_symbol": "CZCE.SR701"},
    {"variety": "CF", "name": "棉花", "contract": "CF2701", "exchange": "CZCE", "sector": "农产品", "tq_symbol": "CZCE.CF701"},
    {"variety": "M", "name": "豆粕", "contract": "M2701", "exchange": "DCE", "sector": "油脂油料", "tq_symbol": "DCE.m2701"},
    {"variety": "A", "name": "豆一", "contract": "A2611", "exchange": "DCE", "sector": "油脂油料", "tq_symbol": "DCE.a2611"},
    {"variety": "B", "name": "豆二", "contract": "B2611", "exchange": "DCE", "sector": "油脂油料", "tq_symbol": "DCE.b2611"},
    {"variety": "V", "name": "PVC", "contract": "V2701", "exchange": "DCE", "sector": "化工", "tq_symbol": "DCE.v2701"},
    {"variety": "TA", "name": "PTA", "contract": "TA2701", "exchange": "CZCE", "sector": "化工", "tq_symbol": "CZCE.TA701"},
    {"variety": "EB", "name": "苯乙烯", "contract": "EB2611", "exchange": "DCE", "sector": "化工", "tq_symbol": "DCE.eb2611"},
    {"variety": "MA", "name": "甲醇", "contract": "MA2610", "exchange": "CZCE", "sector": "化工", "tq_symbol": "CZCE.MA610"},
    {"variety": "RU", "name": "天然橡胶", "contract": "RU2701", "exchange": "SHFE", "sector": "橡胶", "tq_symbol": "SHFE.ru2701"},
    {"variety": "NR", "name": "20号胶", "contract": "NR2611", "exchange": "INE", "sector": "橡胶", "tq_symbol": "INE.nr2611"},
    {"variety": "BR", "name": "丁二烯橡胶", "contract": "BR2611", "exchange": "SHFE", "sector": "橡胶", "tq_symbol": "SHFE.br2611"},
)

COMMODITY_EXCHANGES = frozenset({"SHFE", "DCE", "CZCE", "INE", "GFEX"})
RUBBER_VARIETIES = frozenset({"RU", "NR", "BR"})
CHEMICAL_VARIETIES = frozenset({
    "BU", "FU", "LU", "BZ", "EB", "EG", "L", "PG", "PP", "V",
    "MA", "PF", "PL", "PR", "PX", "SA", "SH", "TA", "UR",
    *RUBBER_VARIETIES,
})
SECTOR_VARIETIES = {
    "贵金属": frozenset({"AU", "AG", "PT", "PD"}),
    "有色": frozenset({"CU", "BC", "AL", "AD", "ZN", "PB", "NI", "SN", "SS", "AO", "LC", "SI", "PS"}),
    "黑色工业": frozenset({"RB", "HC", "I", "J", "JM", "SF", "SM", "WR", "ZC"}),
    "油脂油料": frozenset({"A", "B", "M", "Y", "P", "OI", "RM", "RS", "PK"}),
    "农产品": frozenset({"C", "CS", "RR", "WH", "PM", "RI", "JR", "LR", "CF", "CY", "SR", "AP", "CJ", "JD", "LH"}),
    "橡胶": RUBBER_VARIETIES,
    "能源": frozenset({"SC"}),
    "建材轻工": frozenset({"FG", "SP", "OP", "LG", "FB", "BB"}),
    "航运": frozenset({"EC"}),
}
PRODUCT_NAMES = {
    "P": "棕榈油",
    "OI": "菜籽油",
    "RU": "天然橡胶",
    "NR": "20号胶",
    "BR": "合成橡胶",
}

TIMEFRAMES = {
    "1m": {"seconds": 60, "label": "1 分钟", "data_length": 2_000},
    "5m": {"seconds": 300, "label": "5 分钟", "data_length": 420},
    "15m": {"seconds": 900, "label": "15 分钟", "data_length": 180},
    "30m": {"seconds": 1_800, "label": "30 分钟", "data_length": 900},
    "1h": {"seconds": 3_600, "label": "1 小时", "data_length": 500},
    "1d": {"seconds": 86_400, "label": "日线", "data_length": 90},
    "3d": {"seconds": 3 * 86_400, "label": "3 日 K", "data_length": 160},
}

_lock = threading.Lock()
_worker: subprocess.Popen[bytes] | None = None
_last_error: str | None = None
_trend_worker: subprocess.Popen[bytes] | None = None
_trend_last_error: str | None = None
_panorama_worker: subprocess.Popen[bytes] | None = None
_panorama_last_error: str | None = None


def snapshot_directory() -> Path:
    if settings.market_snapshot_dir:
        return Path(settings.market_snapshot_dir).expanduser().resolve()
    return Path(__file__).resolve().parents[4] / "data" / "live_market"


def snapshot_path(timeframe: str) -> Path:
    return snapshot_directory() / f"{timeframe}.json"


def trend_snapshot_path() -> Path:
    return snapshot_directory() / "trend-1d.json"


def trend_history_snapshot_path() -> Path:
    return snapshot_directory() / "trend-history-1d.json"


def panorama_snapshot_path() -> Path:
    return snapshot_directory() / "panorama-1d.json"


def continuous_symbol_for_instrument(instrument: dict[str, str]) -> str:
    product = re.match(r"[A-Za-z]+", instrument["tq_symbol"].split(".", 1)[-1])
    product_id = product.group(0) if product else instrument["variety"]
    return f"KQ.m@{instrument['exchange']}.{product_id}"


def sector_for_variety(variety: str) -> str:
    for sector, varieties in SECTOR_VARIETIES.items():
        if variety in varieties:
            return sector
    if variety in CHEMICAL_VARIETIES:
        return "化工"
    return "其他"


def include_trend_variety(exchange: str, variety: str) -> bool:
    if exchange not in COMMODITY_EXCHANGES:
        return False
    if variety in RUBBER_VARIETIES:
        return True
    return variety not in CHEMICAL_VARIETIES


def instrument_from_quote(tq_symbol: str, quote: Any) -> dict[str, str]:
    exchange = str(getattr(quote, "exchange_id", None) or tq_symbol.split(".", 1)[0]).upper()
    symbol_code = tq_symbol.split(".", 1)[-1]
    symbol_match = re.match(r"[A-Za-z]+", symbol_code)
    raw_variety = str(getattr(quote, "product_id", None) or (symbol_match.group(0) if symbol_match else symbol_code))
    variety = raw_variety.upper()
    delivery_year = finite_int(getattr(quote, "delivery_year", None))
    delivery_month = finite_int(getattr(quote, "delivery_month", None))
    if delivery_year and delivery_month:
        contract = f"{variety}{delivery_year % 100:02d}{delivery_month:02d}"
    else:
        contract = symbol_code.upper()
    instrument_name = str(getattr(quote, "instrument_name", None) or "")
    name = PRODUCT_NAMES.get(variety) or re.sub(r"\d+$", "", instrument_name).strip() or variety
    return {
        "variety": variety,
        "name": name,
        "contract": contract,
        "exchange": exchange,
        "sector": sector_for_variety(variety),
        "tq_symbol": tq_symbol,
    }


def discover_commodity_universe(api: Any) -> list[dict[str, str]]:
    instruments = []
    seen = set()
    for tq_symbol in api.query_cont_quotes():
        exchange = str(tq_symbol).split(".", 1)[0].upper()
        if exchange not in COMMODITY_EXCHANGES:
            continue
        quote = api.get_quote(tq_symbol)
        instrument = instrument_from_quote(str(tq_symbol), quote)
        variety = instrument["variety"]
        if variety in seen:
            continue
        seen.add(variety)
        instruments.append(instrument)
    instruments.sort(key=lambda item: (item["sector"], item["exchange"], item["variety"]))
    return instruments


def discover_trend_universe(api: Any) -> tuple[list[dict[str, str]], list[str]]:
    all_instruments = discover_commodity_universe(api)
    instruments = [item for item in all_instruments if include_trend_variety(item["exchange"], item["variety"])]
    excluded = [item["variety"] for item in all_instruments if not include_trend_variety(item["exchange"], item["variety"])]
    return instruments, sorted(excluded)


def finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def finite_int(value: Any) -> int | None:
    number = finite_float(value)
    return int(number) if number is not None else None


def timestamp_datetime(value: Any) -> datetime | None:
    number = finite_int(value)
    if not number or number <= 0:
        return None
    return datetime.fromtimestamp(number / 1_000_000_000)


def timestamp_text(value: Any) -> str | None:
    value_datetime = timestamp_datetime(value)
    return value_datetime.strftime("%Y-%m-%d %H:%M:%S") if value_datetime else None


def trading_day_for_datetime(value: datetime) -> date:
    """Assign a futures night-session bar to the following weekday."""
    trading_day = value.date() + timedelta(days=1) if value.hour >= 20 else value.date()
    while trading_day.weekday() >= 5:
        trading_day += timedelta(days=1)
    return trading_day


def recent_trading_day_rows(rows: list[Any], limit: int = 5) -> list[Any]:
    dated_rows = [
        (row, timestamp_datetime(_row_value(row, "datetime")))
        for row in rows
    ]
    dated_rows = [(row, row_time) for row, row_time in dated_rows if row_time is not None]
    available_days = list(dict.fromkeys(trading_day_for_datetime(row_time) for _, row_time in dated_rows))
    selected_days = set(available_days[-limit:])
    return [row for row, row_time in dated_rows if trading_day_for_datetime(row_time) in selected_days]


def quote_time_text(value: Any) -> str | None:
    if not value or str(value).startswith("-"):
        return None
    return str(value).split(".")[0]


def quote_datetime(value: Any) -> datetime | None:
    text = quote_time_text(value)
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def quote_is_live(value: Any, now: datetime | None = None) -> bool:
    tick_time = quote_datetime(value)
    if tick_time is None:
        return False
    return -10 <= ((now or datetime.now()) - tick_time).total_seconds() <= 180


def daily_bar_is_closed(value: Any, now: datetime | None = None) -> bool:
    """Keep the current trading day's partial daily bar out of trend scans."""
    bar_time = timestamp_datetime(value)
    if bar_time is None:
        return False
    current = now or datetime.now()
    bar_trading_day = trading_day_for_datetime(bar_time)
    current_trading_day = trading_day_for_datetime(current)
    if bar_trading_day != current_trading_day:
        return bar_trading_day < current_trading_day
    return time(15, 5) <= current.time() < time(20, 0)


def _row_value(row: Any, key: str) -> Any:
    return row.get(key) if hasattr(row, "get") else row[key]


def build_market_quote(
    instrument: dict[str, str], serial: Any, quote: Any, timeframe: str, *, daily_bar_limit: int | None = None
) -> dict[str, Any]:
    rows = [row for _, row in serial.iterrows() if finite_int(_row_value(row, "datetime"))]
    history_days = 120 if timeframe == "3d" else 80 if timeframe in {"30m", "1h", "1d"} else 5
    price_rows = recent_trading_day_rows(rows, limit=history_days)
    price_points = [
        {"time": timestamp_text(_row_value(row, "datetime")), "price": finite_float(_row_value(row, "close"))}
        for row in price_rows
        if finite_float(_row_value(row, "close")) is not None
    ]
    oi_points: list[dict[str, Any]] = []
    for previous, current in zip(rows, rows[1:]):
        current_oi = finite_int(_row_value(current, "close_oi"))
        previous_oi = finite_int(_row_value(previous, "close_oi"))
        if current_oi is None or previous_oi is None:
            continue
        oi_points.append({
            "time": timestamp_text(_row_value(current, "datetime")),
            "open_interest": current_oi,
            "change": current_oi - previous_oi,
        })
    oi_points = oi_points[-7:]

    oi_change_by_time: dict[str, int] = {}
    for previous, current in zip(rows, rows[1:]):
        current_oi = finite_int(_row_value(current, "close_oi"))
        previous_oi = finite_int(_row_value(previous, "close_oi"))
        current_time = timestamp_text(_row_value(current, "datetime"))
        if current_oi is not None and previous_oi is not None and current_time:
            oi_change_by_time[current_time] = current_oi - previous_oi

    actual_quote_time = quote_datetime(getattr(quote, "datetime", None))
    bars = []
    for index, row in enumerate(price_rows):
        row_time = timestamp_text(_row_value(row, "datetime"))
        close = finite_float(_row_value(row, "close"))
        if not row_time or close is None:
            continue
        if timeframe == "1d":
            is_closed = daily_bar_is_closed(_row_value(row, "datetime"))
        elif timeframe == "3d":
            is_closed = index < len(price_rows) - 1
        else:
            bar_start = timestamp_datetime(_row_value(row, "datetime"))
            is_closed = index < len(price_rows) - 1 or bool(
                bar_start and actual_quote_time and bar_start + timedelta(seconds=TIMEFRAMES[timeframe]["seconds"]) <= actual_quote_time
            )
        bars.append({
            "time": row_time,
            "open": finite_float(_row_value(row, "open")),
            "high": finite_float(_row_value(row, "high")),
            "low": finite_float(_row_value(row, "low")),
            "close": close,
            "volume": finite_int(_row_value(row, "volume")),
            "open_interest": finite_int(_row_value(row, "close_oi")),
            "oi_change": oi_change_by_time.get(row_time),
            "is_closed": is_closed,
        })

    last_row = rows[-1] if rows else None
    previous_row = rows[-2] if len(rows) > 1 else None
    fallback_last = finite_float(_row_value(last_row, "close")) if last_row is not None else None
    fallback_previous = finite_float(_row_value(previous_row, "close")) if previous_row is not None else None
    quoted_price = finite_float(getattr(quote, "last_price", None))
    last_price = quoted_price if quoted_price is not None else fallback_last
    pre_close = finite_float(getattr(quote, "pre_close", None))
    pre_close = pre_close if pre_close is not None else fallback_previous
    change = last_price - pre_close if last_price is not None and pre_close is not None else None
    quote_time = quote_time_text(getattr(quote, "datetime", None)) if actual_quote_time else None
    last_bar_time = timestamp_datetime(_row_value(last_row, "datetime")) if last_row is not None else None
    trading_day = trading_day_for_datetime(actual_quote_time or last_bar_time).isoformat() if actual_quote_time or last_bar_time else None
    status = "LIVE" if quoted_price is not None and quote_is_live(getattr(quote, "datetime", None)) else "CLOSED"
    daily_bars = []
    if timeframe == "1d":
        daily_rows = rows[-daily_bar_limit:] if daily_bar_limit else price_rows
        for row in daily_rows:
            close = finite_float(_row_value(row, "close"))
            if close is None:
                continue
            daily_bars.append({
                "time": timestamp_text(_row_value(row, "datetime")),
                "open": finite_float(_row_value(row, "open")),
                "high": finite_float(_row_value(row, "high")),
                "low": finite_float(_row_value(row, "low")),
                "close": close,
                "volume": finite_int(_row_value(row, "volume")),
                "open_interest": finite_int(_row_value(row, "close_oi")),
                "is_closed": daily_bar_is_closed(_row_value(row, "datetime")),
            })
    open_interest = finite_int(getattr(quote, "open_interest", None))
    if open_interest is None and oi_points:
        open_interest = oi_points[-1]["open_interest"]
    latest_oi_change = oi_points[-1]["change"] if oi_points else None
    return {
        **{key: instrument[key] for key in ("variety", "name", "contract", "exchange")},
        "sector": instrument.get("sector", "自选"),
        "instrument_type": "ACTUAL",
        "tq_symbol": instrument["tq_symbol"],
        "trading_day": trading_day,
        "price_source": "QUOTE" if quoted_price is not None else "BAR_CLOSE",
        "timeframe": timeframe,
        "last_price": last_price,
        "change": change,
        "change_percent": round(change / pre_close * 100, 3) if change is not None and pre_close else None,
        "volume": finite_int(getattr(quote, "volume", None)),
        "open_interest": open_interest,
        "open_interest_change": latest_oi_change,
        "quote_time": quote_time,
        "status": status,
        "price_points": price_points,
        "oi_points": oi_points,
        "bars": bars,
        "daily_bars": daily_bars,
    }


def empty_quote(instrument: dict[str, str], timeframe: str) -> dict[str, Any]:
    return {
        **{key: instrument[key] for key in ("variety", "name", "contract", "exchange")},
        "sector": instrument.get("sector", "自选"),
        "instrument_type": "ACTUAL",
        "tq_symbol": instrument["tq_symbol"],
        "trading_day": None,
        "price_source": "UNAVAILABLE",
        "timeframe": timeframe,
        "last_price": None,
        "change": None,
        "change_percent": None,
        "volume": None,
        "open_interest": None,
        "open_interest_change": None,
        "quote_time": None,
        "status": "DELAYED",
        "price_points": [],
        "oi_points": [],
        "bars": [],
        "daily_bars": [],
    }


def start_live_feed() -> None:
    global _worker, _last_error
    with _lock:
        if _worker is not None and _worker.poll() is None:
            return
        if not settings.tqsdk_user or not settings.tqsdk_password:
            _last_error = "TqSdk 账号未配置，正在使用最后静态快照"
            return
        output_dir = snapshot_directory()
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            _worker = subprocess.Popen(
                [sys.executable, "-m", "app.workers.tqsdk_live_worker", "--output-dir", str(output_dir)],
                cwd=Path(__file__).resolve().parents[2],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                close_fds=True,
            )
            _last_error = None
        except OSError as exc:
            _last_error = str(exc)


def fetch_live_quotes(timeframe: str = "5m") -> dict[str, Any]:
    """Return the newest durable snapshot, even when the market or TqSdk is offline."""
    if timeframe not in TIMEFRAMES:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    start_live_feed()
    try:
        payload = json.loads(snapshot_path(timeframe).read_text(encoding="utf-8"))
        fetched_at = datetime.fromisoformat(payload["fetched_at"])
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        age = max(0, (datetime.now(timezone.utc) - fetched_at).total_seconds())
        worker_error = _last_error
        if _worker is not None and _worker.poll() is not None:
            worker_error = f"TqSdk 行情进程已退出（code {_worker.returncode}），正在使用最后静态快照"
        expired = age > 30 and payload.get("data_mode") == "LIVE"
        return {
            **payload,
            "cache_age_seconds": round(age, 1),
            "connection_error": worker_error,
            "data_mode": "STATIC" if expired else payload["data_mode"],
            "quotes": [
                {**item, "status": "DELAYED" if item.get("status") == "LIVE" else item.get("status")}
                for item in payload["quotes"]
            ] if expired else payload["quotes"],
        }
    except (FileNotFoundError, json.JSONDecodeError, KeyError, ValueError):
        return {
            "source": "TQSDK",
            "fetched_at": datetime.now(timezone.utc),
            "cache_age_seconds": None,
            "connection_error": _last_error,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAMES[timeframe]["label"],
            "data_mode": "WAITING",
            "quotes": [empty_quote(instrument, timeframe) for instrument in LIVE_INSTRUMENTS],
        }


def fetch_terminal_quote(contract: str, timeframe: str = "5m") -> dict[str, Any]:
    """Return one contract's chart payload for the standalone trading terminal."""
    payload = fetch_live_quotes(timeframe)
    quote = next((item for item in payload["quotes"] if item.get("contract") == contract), None)
    if quote is None:
        raise ValueError(f"Unknown terminal contract: {contract}")
    return {**{key: payload[key] for key in ("source", "fetched_at", "cache_age_seconds", "connection_error", "timeframe", "timeframe_label", "data_mode")}, "quote": quote}


def fetch_watchlist_quotes() -> dict[str, Any]:
    """Project the shared daily snapshot into small, timeframe-independent prices."""
    payload = fetch_live_quotes("1d")
    return {
        **{key: payload[key] for key in ("source", "fetched_at", "cache_age_seconds", "connection_error", "data_mode")},
        "quotes": [
            {key: quote.get(key) for key in ("contract", "last_price", "change_percent", "quote_time", "status")}
            for quote in payload["quotes"]
        ],
    }


def start_trend_feed() -> None:
    global _trend_worker, _trend_last_error
    with _lock:
        if _trend_worker is not None and _trend_worker.poll() is None:
            return
        if not settings.tqsdk_user or not settings.tqsdk_password:
            _trend_last_error = "TqSdk 账号未配置，正在使用最后趋势快照"
            return
        output_dir = snapshot_directory()
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            _trend_worker = subprocess.Popen(
                [sys.executable, "-m", "app.workers.tqsdk_trend_worker", "--output-dir", str(output_dir)],
                cwd=Path(__file__).resolve().parents[2],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                close_fds=True,
            )
            _trend_last_error = None
        except OSError as exc:
            _trend_last_error = str(exc)


def fetch_trend_quotes() -> dict[str, Any]:
    """Return the all-commodity dominant-contract daily snapshot."""
    start_trend_feed()
    try:
        payload = json.loads(trend_snapshot_path().read_text(encoding="utf-8"))
        fetched_at = datetime.fromisoformat(payload["fetched_at"])
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        age = max(0, (datetime.now(timezone.utc) - fetched_at).total_seconds())
        worker_error = _trend_last_error
        if _trend_worker is not None and _trend_worker.poll() is not None:
            worker_error = f"TqSdk 全市场趋势进程已退出（code {_trend_worker.returncode}），正在使用最后静态快照"
        return {**payload, "cache_age_seconds": round(age, 1), "connection_error": worker_error}
    except (FileNotFoundError, json.JSONDecodeError, KeyError, ValueError):
        return {
            "source": "TQSDK",
            "fetched_at": datetime.now(timezone.utc),
            "cache_age_seconds": None,
            "connection_error": _trend_last_error,
            "timeframe": "1d",
            "timeframe_label": TIMEFRAMES["1d"]["label"],
            "data_mode": "WAITING",
            "universe_name": "国内商品主力",
            "universe_size": 0,
            "commodity_count": 0,
            "excluded_chemical_count": 0,
            "excluded_varieties": [],
            "rubber_exceptions": sorted(RUBBER_VARIETIES),
            "quotes": [],
        }


def fetch_trend_history() -> dict[str, Any]:
    """Return the durable main-continuous daily history used only for trend validation."""
    start_trend_feed()
    try:
        payload = json.loads(trend_history_snapshot_path().read_text(encoding="utf-8"))
        fetched_at = datetime.fromisoformat(payload["fetched_at"])
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        age = max(0, (datetime.now(timezone.utc) - fetched_at).total_seconds())
        worker_error = _trend_last_error
        if _trend_worker is not None and _trend_worker.poll() is not None:
            worker_error = f"TqSdk 全市场趋势进程已退出（code {_trend_worker.returncode}），正在使用最后静态历史"
        return {**payload, "cache_age_seconds": round(age, 1), "connection_error": worker_error}
    except (FileNotFoundError, json.JSONDecodeError, KeyError, ValueError):
        return {
            "source": "TQSDK",
            "fetched_at": datetime.now(timezone.utc),
            "cache_age_seconds": None,
            "connection_error": _trend_last_error,
            "data_mode": "WAITING",
            "history_days": 0,
            "quotes": [],
        }


def start_panorama_feed() -> None:
    global _panorama_worker, _panorama_last_error
    with _lock:
        if _panorama_worker is not None and _panorama_worker.poll() is None:
            return
        if not settings.tqsdk_user or not settings.tqsdk_password:
            _panorama_last_error = "TqSdk 账号未配置，正在使用最后价格快照"
            return
        output_dir = snapshot_directory()
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            _panorama_worker = subprocess.Popen(
                [sys.executable, "-m", "app.workers.tqsdk_panorama_worker", "--output-dir", str(output_dir)],
                cwd=Path(__file__).resolve().parents[2],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                close_fds=True,
            )
            _panorama_last_error = None
        except OSError as exc:
            _panorama_last_error = str(exc)


def fetch_panorama_quotes() -> dict[str, Any]:
    """Return the price-only snapshot for all domestic commodity varieties."""
    start_panorama_feed()
    try:
        payload = json.loads(panorama_snapshot_path().read_text(encoding="utf-8"))
        fetched_at = datetime.fromisoformat(payload["fetched_at"])
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        age = max(0, (datetime.now(timezone.utc) - fetched_at).total_seconds())
        worker_error = _panorama_last_error
        if _panorama_worker is not None and _panorama_worker.poll() is not None:
            worker_error = f"TqSdk 全景行情进程已退出（code {_panorama_worker.returncode}），正在使用最后静态快照"
        expired = age > 60 and payload.get("data_mode") == "LIVE"
        return {
            **payload,
            "cache_age_seconds": round(age, 1),
            "connection_error": worker_error,
            "data_mode": "STATIC" if expired else payload["data_mode"],
            "quotes": [
                {**item, "status": "DELAYED" if item.get("status") == "LIVE" else item.get("status")}
                for item in payload["quotes"]
            ] if expired else payload["quotes"],
        }
    except (FileNotFoundError, json.JSONDecodeError, KeyError, ValueError):
        return {
            "source": "TQSDK",
            "fetched_at": datetime.now(timezone.utc),
            "cache_age_seconds": None,
            "connection_error": _panorama_last_error,
            "data_mode": "WAITING",
            "universe_name": "国内商品主力",
            "universe_size": 0,
            "quotes": [],
        }


def stop_market_feeds() -> None:
    for process in (_worker, _trend_worker, _panorama_worker):
        if process is not None and process.poll() is None:
            process.terminate()
