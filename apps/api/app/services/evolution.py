from collections import defaultdict
from datetime import date

from sqlalchemy import distinct, select
from sqlalchemy.orm import Session

from app.models.position import PositionFeature


def get_evolution(db: Session, symbol: str, start: date | None, end: date | None, days: int):
    query = select(distinct(PositionFeature.trade_date)).where(PositionFeature.symbol == symbol)
    if start:
        query = query.where(PositionFeature.trade_date >= start)
    if end:
        query = query.where(PositionFeature.trade_date <= end)
    dates = sorted(db.scalars(query.order_by(PositionFeature.trade_date.desc()).limit(days)).all())
    if not dates:
        return {"symbol": symbol, "dates": [], "daily": [], "brokers": []}
    rows = db.scalars(select(PositionFeature).where(
        PositionFeature.symbol == symbol, PositionFeature.trade_date.in_(dates)
    )).all()
    by_day = defaultdict(dict)
    by_broker = defaultdict(dict)
    for row in rows:
        by_day[row.trade_date][row.broker] = row.net_position
        by_broker[row.broker][row.trade_date] = row.net_position
    daily = []
    previous = None
    for day in dates:
        values = by_day[day]
        long = sum(max(v, 0) for v in values.values())
        short = sum(max(-v, 0) for v in values.values())
        same_sample = previous is not None and values.keys() == previous.keys()
        daily.append({
            "date": day, "net_long": long, "net_short": short, "net": long - short,
            "count": len(values),
            "change": sum(values.values()) - sum(previous.values()) if same_sample else None,
        })
        previous = values
    brokers = []
    for broker, values in by_broker.items():
        first, last = values.get(dates[0]), values.get(dates[-1])
        brokers.append({
            "broker": broker, "values": [values.get(day) for day in dates],
            "change": last - first if len(dates) > 1 and first is not None and last is not None else None,
            "coverage": len(values),
        })
    brokers.sort(key=lambda b: max(abs(v) for v in b["values"] if v is not None), reverse=True)
    return {"symbol": symbol, "dates": dates, "daily": daily, "brokers": brokers}
