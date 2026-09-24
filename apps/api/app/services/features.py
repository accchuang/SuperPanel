from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.position import PositionFeature, RawPosition


def rebuild_features(db: Session) -> int:
    db.execute(delete(PositionFeature))
    rows = db.scalars(
        select(RawPosition).order_by(RawPosition.symbol, RawPosition.trade_date, RawPosition.rank)
    ).all()

    grouped: dict[tuple[str, date], list[RawPosition]] = defaultdict(list)
    for row in rows:
        grouped[(row.symbol, row.trade_date)].append(row)

    streaks: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"long_add": 0, "long_reduce": 0, "short_add": 0, "short_reduce": 0}
    )
    inserted = 0

    for (symbol, trade_date), day_rows in sorted(grouped.items(), key=lambda item: (item[0][0], item[0][1])):
        total_long = sum(item.long_position for item in day_rows) or 1
        total_short = sum(item.short_position for item in day_rows) or 1
        total_oi = sum(item.long_position + item.short_position for item in day_rows) or 1
        top5_oi = sum(item.long_position + item.short_position for item in day_rows if item.rank <= 5)
        top10_oi = sum(item.long_position + item.short_position for item in day_rows if item.rank <= 10)
        top5_concentration = Decimal(top5_oi) / Decimal(total_oi)
        top10_concentration = Decimal(top10_oi) / Decimal(total_oi)

        for item in day_rows:
            key = (symbol, item.broker)
            broker_streak = streaks[key]
            broker_streak["long_add"] = broker_streak["long_add"] + 1 if item.long_change > 0 else 0
            broker_streak["long_reduce"] = broker_streak["long_reduce"] + 1 if item.long_change < 0 else 0
            broker_streak["short_add"] = broker_streak["short_add"] + 1 if item.short_change > 0 else 0
            broker_streak["short_reduce"] = broker_streak["short_reduce"] + 1 if item.short_change < 0 else 0

            db.add(
                PositionFeature(
                    trade_date=trade_date,
                    symbol=symbol,
                    broker=item.broker,
                    rank=item.rank,
                    long_position=item.long_position,
                    long_change=item.long_change,
                    short_position=item.short_position,
                    short_change=item.short_change,
                    net_position=item.long_position - item.short_position,
                    net_change=item.long_change - item.short_change,
                    long_ratio=Decimal(item.long_position) / Decimal(total_long),
                    short_ratio=Decimal(item.short_position) / Decimal(total_short),
                    top5_concentration=top5_concentration,
                    top10_concentration=top10_concentration,
                    consecutive_long_add_days=broker_streak["long_add"],
                    consecutive_long_reduce_days=broker_streak["long_reduce"],
                    consecutive_short_add_days=broker_streak["short_add"],
                    consecutive_short_reduce_days=broker_streak["short_reduce"],
                )
            )
            inserted += 1

    db.commit()
    return inserted


def latest_trade_date(db: Session, symbol: str | None = None) -> date | None:
    stmt = select(func.max(RawPosition.trade_date))
    if symbol:
        stmt = stmt.where(RawPosition.symbol == symbol)
    return db.scalar(stmt)
