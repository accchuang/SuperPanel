import csv
import random
from datetime import date, timedelta
from pathlib import Path

SECTOR_SYMBOLS = {
    "black_industrial": ["RB", "HC", "I", "J", "JM", "SF", "SM"],
    "nonferrous": ["CU", "AL", "ZN", "PB", "NI", "SN", "AO"],
    "agriculture": ["A", "M", "C", "CS", "JD", "CF", "SR", "AP", "PK"],
    "oils": ["Y", "P", "OI", "RM"],
    "precious": ["AU", "AG"],
}
SYMBOLS = [symbol for symbols in SECTOR_SYMBOLS.values() for symbol in symbols]
BROKERS = [
    "永安期货",
    "中信期货",
    "国泰君安",
    "银河期货",
    "东证期货",
    "华泰期货",
    "申银万国",
    "海通期货",
    "方正中期",
    "光大期货",
    "浙商期货",
    "招商期货",
    "南华期货",
    "广发期货",
    "瑞达期货",
    "国投安信",
    "兴证期货",
    "宏源期货",
    "新湖期货",
    "五矿期货",
]


def trading_days(end: date, count: int) -> list[date]:
    days: list[date] = []
    current = end
    while len(days) < count:
        if current.weekday() < 5:
            days.append(current)
        current -= timedelta(days=1)
    return list(reversed(days))


def main() -> None:
    random.seed(42)
    output = Path(__file__).resolve().parents[1] / "data" / "mock_positions.csv"
    output.parent.mkdir(parents=True, exist_ok=True)
    days = trading_days(date(2026, 9, 4), 30)
    rows: list[dict[str, object]] = []

    for symbol_idx, symbol in enumerate(SYMBOLS):
        state = {
            broker: {
                "long": 18000 + rank * 2600 + symbol_idx * 900 + random.randint(-1200, 1200),
                "short": 16500 + rank * 2300 + symbol_idx * 800 + random.randint(-1100, 1100),
            }
            for rank, broker in enumerate(BROKERS, start=1)
        }

        for day_idx, day in enumerate(days):
            symbol_bias = 1 if symbol in {"RB", "HC", "CU", "AL", "AU", "AG", "Y"} else -1 if symbol in {"J", "JM", "SF", "SM", "M"} else 0
            ranked: list[tuple[str, int, int, int, int]] = []
            for broker_idx, broker in enumerate(BROKERS):
                persistent_long_flow = 520 if broker == "永安期货" and day_idx >= 24 and symbol == "RB" else 0
                persistent_short_flow = 390 if broker == "中信期货" and day_idx >= 23 and symbol == "J" else 0
                long_change = random.randint(-900, 1100) + symbol_bias * 110 + persistent_long_flow
                short_change = random.randint(-850, 1050) - symbol_bias * 90 + persistent_short_flow
                if broker_idx < 5:
                    long_change += 120
                    short_change += 80
                state[broker]["long"] = max(1000, state[broker]["long"] + long_change)
                state[broker]["short"] = max(1000, state[broker]["short"] + short_change)
                ranked.append((broker, state[broker]["long"], long_change, state[broker]["short"], short_change))

            ranked.sort(key=lambda item: item[1] + item[3], reverse=True)
            for rank, (broker, long_position, long_change, short_position, short_change) in enumerate(ranked, start=1):
                rows.append(
                    {
                        "date": day.isoformat(),
                        "symbol": symbol,
                        "broker": broker,
                        "long_position": long_position,
                        "long_change": long_change,
                        "short_position": short_position,
                        "short_change": short_change,
                        "rank": rank,
                    }
                )

    with output.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "date",
                "symbol",
                "broker",
                "long_position",
                "long_change",
                "short_position",
                "short_change",
                "rank",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {output}")


if __name__ == "__main__":
    main()
