from datetime import date, timedelta

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models.position import PositionFeature, RawPosition
from app.services.features import latest_trade_date


def resolve_date(db: Session, symbol: str, trade_date: date | None) -> date:
    resolved = trade_date or latest_trade_date(db, symbol)
    if resolved is None:
        raise ValueError(f"No data found for symbol {symbol}")
    return resolved


def get_overview(db: Session, symbol: str, trade_date: date | None) -> dict:
    day = resolve_date(db, symbol, trade_date)
    rows = db.scalars(
        select(PositionFeature).where(PositionFeature.symbol == symbol, PositionFeature.trade_date == day)
    ).all()
    if not rows:
        raise ValueError(f"No feature data found for {symbol} on {day}")

    long_change = sum(row.long_change for row in rows)
    short_change = sum(row.short_change for row in rows)
    long_total = sum(row.long_position for row in rows)
    short_total = sum(row.short_position for row in rows)
    net_change = long_change - short_change
    oi_change = long_change + short_change
    denominator = max(abs(long_change) + abs(short_change), 1)
    score = round(50 + 50 * net_change / denominator, 2)
    trend = "Bullish" if score >= 60 else "Bearish" if score <= 40 else "Neutral"

    return {
        "symbol": symbol,
        "date": day,
        "long_change": long_change,
        "short_change": short_change,
        "oi_change": oi_change,
        "net_change": net_change,
        "long_short_score": score,
        "trend_state": trend,
        "top5_concentration": float(rows[0].top5_concentration),
        "top10_concentration": float(rows[0].top10_concentration),
        "long_total": long_total,
        "short_total": short_total,
    }


def get_leaderboard(db: Session, symbol: str, trade_date: date | None, limit: int = 20) -> list[PositionFeature]:
    day = resolve_date(db, symbol, trade_date)
    return db.scalars(
        select(PositionFeature)
        .where(PositionFeature.symbol == symbol, PositionFeature.trade_date == day)
        .order_by(PositionFeature.rank)
        .limit(limit)
    ).all()


def get_trend(db: Session, symbol: str, trade_date: date | None, days: int = 30, brokers: int = 5) -> list[dict]:
    day = resolve_date(db, symbol, trade_date)
    start = day - timedelta(days=days * 2)
    top_brokers = db.scalars(
        select(PositionFeature.broker)
        .where(PositionFeature.symbol == symbol, PositionFeature.trade_date == day)
        .order_by(desc(func.abs(PositionFeature.net_position)))
        .limit(brokers)
    ).all()
    result = []
    for broker in top_brokers:
        points = db.scalars(
            select(PositionFeature)
            .where(
                PositionFeature.symbol == symbol,
                PositionFeature.broker == broker,
                PositionFeature.trade_date <= day,
                PositionFeature.trade_date >= start,
            )
            .order_by(PositionFeature.trade_date)
            .limit(days)
        ).all()
        result.append(
            {
                "broker": broker,
                "points": [
                    {
                        "date": point.trade_date,
                        "broker": point.broker,
                        "net_position": point.net_position,
                        "long_change": point.long_change,
                        "short_change": point.short_change,
                    }
                    for point in points
                ],
            }
        )
    return result


def get_strength(db: Session, symbol: str, trade_date: date | None) -> dict:
    day = resolve_date(db, symbol, trade_date)
    rows = db.scalars(
        select(PositionFeature).where(PositionFeature.symbol == symbol, PositionFeature.trade_date == day)
    ).all()
    long_total = sum(row.long_position for row in rows)
    short_total = sum(row.short_position for row in rows)
    net_positions = [row.net_position for row in rows]
    net_long = sum(max(value, 0) for value in net_positions)
    net_short = sum(abs(min(value, 0)) for value in net_positions)
    return {
        "long": long_total,
        "short": short_total,
        "net": net_long - net_short,
        "net_long": net_long,
        "net_short": net_short,
    }


def get_summary(db: Session, symbol: str, trade_date: date | None) -> dict:
    day = resolve_date(db, symbol, trade_date)
    overview = get_overview(db, symbol, day)
    leaderboard = get_leaderboard(db, symbol, day, limit=20)
    top_long_streak = max(leaderboard, key=lambda row: row.consecutive_long_add_days)
    concentration = "继续提高" if overview["top5_concentration"] >= 0.32 else "保持分散"
    bias = "偏强" if overview["trend_state"] == "Bullish" else "偏弱" if overview["trend_state"] == "Bearish" else "中性"
    summary = (
        f"{top_long_streak.broker}连续第{top_long_streak.consecutive_long_add_days}天增仓，"
        f"Top5集中度{concentration}，市场{bias}。"
        if top_long_streak.consecutive_long_add_days > 1
        else f"今日净多变化{overview['net_change']:,}手，Top5集中度{overview['top5_concentration']:.1%}，市场{bias}。"
    )
    return {"symbol": symbol, "date": day, "summary": summary}
