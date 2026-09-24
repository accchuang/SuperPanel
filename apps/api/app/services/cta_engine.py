from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.cta import ContractInfo, DecisionReport, MarketBar
from app.models.position import PositionFeature
from app.schemas.cta import (
    BacktestDatesOut,
    ContractOut,
    DecisionNodeResult,
    DecisionReportOut,
    ForwardPerformanceOut,
    HistoricalBacktestOut,
    PositionStructureAnalysisOut,
    TrendAnalysisOut,
)


RULE_VERSION = "cta-simple-1.0"
MIN_DAILY_BARS = 20
BACKTEST_HORIZONS = (1, 3, 5)


@dataclass(frozen=True)
class Point:
    close_time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int
    open_interest: int | None


def clamp(value: float) -> float:
    return round(max(0.0, min(100.0, value)), 1)


def sma(values: list[float], length: int) -> float | None:
    return sum(values[-length:]) / length if len(values) >= length else None


def node(name: str, status: str, conclusion: str, *, score: float | None = None,
         direction: str = "UNKNOWN", positive: list[str] | None = None,
         negative: list[str] | None = None, missing: list[str] | None = None,
         metrics: dict | None = None, quality: str = "COMPLETE") -> DecisionNodeResult:
    return DecisionNodeResult(
        node_name=name, status=status, score=score, direction=direction,
        positive_evidence=positive or [], negative_evidence=negative or [],
        missing_conditions=missing or [], raw_metrics=metrics or {}, conclusion=conclusion,
        data_quality=quality,
    )


def to_points(rows: list[MarketBar]) -> list[Point]:
    return [Point(
        close_time=row.close_time, open=float(row.open), high=float(row.high), low=float(row.low),
        close=float(row.close), volume=row.volume, open_interest=row.open_interest,
    ) for row in rows]


def contract_to_out(contract: ContractInfo) -> ContractOut:
    return ContractOut(
        variety=contract.variety, contract=contract.contract, exchange=contract.exchange,
        multiplier=contract.multiplier, tick_size=contract.tick_size,
        first_notice_date=contract.first_notice_date, last_trade_date=contract.last_trade_date,
        margin_rate=contract.margin_rate, limit_ratio=contract.limit_ratio, is_active=contract.is_active,
    )


def trading_date(close_time: datetime) -> date:
    """Translate TqSdk's 16:00 UTC daily-bar stamp to its China trading date."""
    if close_time.hour == 16 and close_time.minute == 0:
        return (close_time + timedelta(days=1)).date()
    return close_time.date()


def completed_daily_rows(db: Session, contract: ContractInfo) -> list[MarketBar]:
    return list(db.scalars(select(MarketBar).where(
        MarketBar.contract_id == contract.id,
        MarketBar.timeframe == "D1",
        MarketBar.is_final.is_(True),
    ).order_by(MarketBar.close_time)).all())


def analyze_trend(bars: list[Point]) -> tuple[TrendAnalysisOut | None, DecisionNodeResult]:
    """Price factor: daily close and the MA5/MA20 relationship."""
    if len(bars) < MIN_DAILY_BARS:
        return None, node("Daily Trend", "UNKNOWN", "日线样本不足，无法计算趋势。", missing=["至少 20 根已收盘日线"], quality="PARTIAL")
    closes = [bar.close for bar in bars]
    ma5, ma20, prior_ma5 = sma(closes, 5), sma(closes, 20), sma(closes[:-3], 5)
    if ma5 is None or ma20 is None or prior_ma5 is None:
        return None, node("Daily Trend", "UNKNOWN", "均线样本不足。", missing=["MA5、MA20"], quality="PARTIAL")

    slope = ma5 - prior_ma5
    long_signal = closes[-1] > ma5 > ma20 and slope > 0
    short_signal = closes[-1] < ma5 < ma20 and slope < 0
    direction = "LONG" if long_signal else "SHORT" if short_signal else "NEUTRAL"
    score = 100.0 if direction != "NEUTRAL" else 0.0
    stage = "CONFIRMED" if direction != "NEUTRAL" else "RANGE"
    metrics = {"close": round(closes[-1], 4), "ma5": round(ma5, 4), "ma20": round(ma20, 4), "ma5_change_3d": round(slope, 4)}
    status = "PASS" if direction != "NEUTRAL" else "FAIL"
    trend = TrendAnalysisOut(direction=direction, score=score, stage=stage, metrics=metrics)
    conclusion = f"{direction}：收盘价与 MA5/MA20 同向。" if status == "PASS" else "均线未形成明确的多头或空头排列。"
    return trend, node(
        "Daily Trend", status, conclusion, score=score, direction=direction,
        positive=["收盘价、MA5、MA20 与短均线方向一致"] if status == "PASS" else [],
        negative=["等待明确的均线排列"] if status == "FAIL" else [], metrics=metrics,
    )


def analyze_structure(rows: list[PositionFeature], trend_direction: str) -> tuple[PositionStructureAnalysisOut | None, DecisionNodeResult]:
    """Position factor: aggregate net-position change across the two latest trading days."""
    dates = sorted({row.trade_date for row in rows})
    if len(dates) < 2:
        return None, node("Net Position Change", "UNKNOWN", "缺少最近两日席位净持仓数据。", missing=["至少 2 个交易日龙虎榜"], quality="PARTIAL")
    previous_date, latest_date = dates[-2:]
    previous = sum(row.net_position for row in rows if row.trade_date == previous_date)
    latest = sum(row.net_position for row in rows if row.trade_date == latest_date)
    change = latest - previous
    direction = "LONG" if change > 0 else "SHORT" if change < 0 else "NEUTRAL"
    scale = max(abs(previous), abs(latest), 1)
    change_ratio = abs(change) / scale
    aligned = direction == trend_direction and direction in {"LONG", "SHORT"}
    score = clamp((70 if aligned else 0) + min(change_ratio * 300, 30))
    metrics = {
        "previous_date": previous_date.isoformat(), "latest_date": latest_date.isoformat(),
        "previous_net_position": previous, "latest_net_position": latest,
        "net_position_change": change, "change_ratio": round(change_ratio, 4),
    }
    status = "PASS" if aligned else "FAIL"
    result = PositionStructureAnalysisOut(direction=direction, score=score, metrics=metrics)
    conclusion = "席位净持仓变化与日线趋势同向。" if aligned else "席位净持仓变化尚未与日线趋势同向。"
    return result, node(
        "Net Position Change", status, conclusion, score=score, direction=direction,
        positive=["最近两日净持仓变化与趋势同向"] if aligned else [],
        negative=["等待净持仓变化与趋势同向"] if not aligned else [], metrics=metrics,
    )


def evaluate_contract(db: Session, contract_code: str, as_of: date | None = None) -> DecisionReportOut:
    contract = db.scalar(select(ContractInfo).where(ContractInfo.contract == contract_code.upper()))
    if contract is None:
        raise ValueError(f"Unknown CTA contract: {contract_code}")
    all_daily = completed_daily_rows(db, contract)
    if as_of is not None:
        daily_rows = [row for row in all_daily if trading_date(row.close_time) <= as_of]
        if not daily_rows or trading_date(daily_rows[-1].close_time) != as_of:
            raise ValueError(f"No completed D1 bar for {contract.contract} on {as_of.isoformat()}")
    else:
        daily_rows = all_daily
    daily_rows = daily_rows[-MIN_DAILY_BARS:]
    daily = to_points(daily_rows)
    snapshot_date = trading_date(daily[-1].close_time) if daily else as_of
    position_query = select(PositionFeature.trade_date).where(PositionFeature.symbol == contract.variety)
    if snapshot_date is not None:
        position_query = position_query.where(PositionFeature.trade_date <= snapshot_date)
    dates = db.scalars(position_query.distinct().order_by(PositionFeature.trade_date.desc()).limit(2)).all()
    positions = db.scalars(select(PositionFeature).where(
        PositionFeature.symbol == contract.variety, PositionFeature.trade_date.in_(dates),
    )).all() if dates else []

    data_missing = [] if len(daily) >= MIN_DAILY_BARS else ["D1 已收盘 Bar"]
    data_node = node(
        "Data Quality", "PASS" if not data_missing else "UNKNOWN",
        "日线数据完整。" if not data_missing else "缺少趋势计算所需日线数据。",
        positive=["使用已收盘日线"] if not data_missing else [], missing=data_missing,
        metrics={"D1": len(daily)}, quality="COMPLETE" if not data_missing else "PARTIAL",
    )
    reference_date = snapshot_date or date.today()
    validity_status = "PASS" if contract.is_active and (not contract.last_trade_date or contract.last_trade_date >= reference_date) else "FAIL"
    validity_node = node(
        "Contract Validity", validity_status,
        "合约可研究。" if validity_status == "PASS" else "合约停用或已过最后交易日。",
        negative=[] if validity_status == "PASS" else ["合约停用或到期"],
        metrics={"contract": contract.contract, "last_trade_date": contract.last_trade_date.isoformat() if contract.last_trade_date else None},
    )
    trend, trend_node = analyze_trend(daily)
    structure, structure_node = analyze_structure(positions, trend.direction if trend else "UNKNOWN")
    nodes = [data_node, validity_node, trend_node, structure_node]

    blocking: list[str] = []
    warnings: list[str] = []
    if data_node.status == "UNKNOWN":
        state = "DATA_INCOMPLETE"
        blocking.extend(data_node.missing_conditions)
    elif validity_node.status == "FAIL":
        state = "REJECT"
        blocking.append(validity_node.conclusion)
    elif trend_node.status != "PASS":
        state = "WATCH"
        blocking.append(trend_node.conclusion)
    elif structure_node.status == "UNKNOWN":
        state = "WAIT_FOR_STRUCTURE"
        blocking.extend(structure_node.missing_conditions)
        warnings.append("趋势已满足，等待席位净持仓数据后再判断。")
    elif structure_node.status != "PASS":
        state = "WAIT_FOR_STRUCTURE"
        blocking.append(structure_node.conclusion)
    else:
        state = "READY"

    summary = f"{contract.contract}：{state}。仅基于日线趋势与席位净持仓变化；机器状态不构成买卖指令。"
    return DecisionReportOut(
        contract=contract.contract, variety=contract.variety, generated_at=datetime.utcnow(),
        snapshot_time=daily[-1].close_time if daily else None, rule_version=RULE_VERSION,
        direction=trend.direction if trend else "UNKNOWN", trend_stage=trend.stage if trend else "UNKNOWN",
        trend_score=trend.score if trend else None, structure_score=structure.score if structure else None,
        entry_score=None, risk_score=None, system_state=state,
        data_quality="COMPLETE" if data_node.status == "PASS" else "PARTIAL",
        blocking_reasons=blocking, warnings=warnings, nodes=nodes,
        trend=trend, structure=structure, entry=None, risk=None, summary=summary,
    )


def backtest_dates(db: Session, contract_code: str) -> BacktestDatesOut:
    contract = db.scalar(select(ContractInfo).where(ContractInfo.contract == contract_code.upper()))
    if contract is None:
        raise ValueError(f"Unknown CTA contract: {contract_code}")
    rows = completed_daily_rows(db, contract)
    last_required_index = max(BACKTEST_HORIZONS)
    dates = [
        trading_date(row.close_time)
        for index, row in enumerate(rows)
        if index >= MIN_DAILY_BARS - 1 and index + last_required_index < len(rows)
    ]
    return BacktestDatesOut(contract=contract.contract, dates=dates)


def backtest_contract(db: Session, contract_code: str, as_of: date) -> HistoricalBacktestOut:
    contract = db.scalar(select(ContractInfo).where(ContractInfo.contract == contract_code.upper()))
    if contract is None:
        raise ValueError(f"Unknown CTA contract: {contract_code}")
    rows = completed_daily_rows(db, contract)
    index = next((offset for offset, row in enumerate(rows) if trading_date(row.close_time) == as_of), None)
    if index is None:
        raise ValueError(f"No completed D1 bar for {contract.contract} on {as_of.isoformat()}")

    report = evaluate_contract(db, contract.contract, as_of=as_of)
    entry_price = float(rows[index].close)
    signal_active = report.system_state == "READY" and report.direction in {"LONG", "SHORT"}
    multiplier = 1 if report.direction == "LONG" else -1
    performance: list[ForwardPerformanceOut] = []
    for horizon in BACKTEST_HORIZONS:
        exit_index = index + horizon
        if exit_index >= len(rows):
            performance.append(ForwardPerformanceOut(
                horizon_trading_days=horizon,
                exit_date=None,
                entry_price=entry_price,
                exit_price=None,
                raw_return_percent=None,
                directional_return_percent=None,
                outcome="UNKNOWN",
            ))
            continue
        exit_row = rows[exit_index]
        exit_price = float(exit_row.close)
        raw_return = round((exit_price / entry_price - 1) * 100, 2)
        directional_return = round(raw_return * multiplier, 2) if signal_active else None
        outcome = (
            "NOT_TRIGGERED" if not signal_active else "WIN" if directional_return > 0 else "LOSS" if directional_return < 0 else "FLAT"
        )
        performance.append(ForwardPerformanceOut(
            horizon_trading_days=horizon,
            exit_date=trading_date(exit_row.close_time),
            entry_price=entry_price,
            exit_price=exit_price,
            raw_return_percent=raw_return,
            directional_return_percent=directional_return,
            outcome=outcome,
        ))
    return HistoricalBacktestOut(
        contract=contract.contract,
        variety=contract.variety,
        as_of_date=as_of,
        report=report,
        performance=performance,
    )


def save_report(db: Session, report: DecisionReportOut) -> DecisionReport:
    contract = db.scalar(select(ContractInfo).where(ContractInfo.contract == report.contract))
    if contract is None:
        raise ValueError(f"Unknown CTA contract: {report.contract}")
    row = DecisionReport(
        contract_id=contract.id, generated_at=report.generated_at, snapshot_time=report.snapshot_time,
        rule_version=report.rule_version, direction=report.direction, trend_stage=report.trend_stage,
        trend_score=report.trend_score, structure_score=report.structure_score, entry_score=None, risk_score=None,
        system_state=report.system_state, data_quality=report.data_quality,
        blocking_reasons=report.blocking_reasons, warnings=report.warnings,
        nodes=[item.model_dump(mode="json") for item in report.nodes], summary=report.summary,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def report_from_row(row: DecisionReport, contract: ContractInfo) -> DecisionReportOut:
    nodes = [DecisionNodeResult.model_validate(item) for item in row.nodes]
    by_name = {item.node_name: item for item in nodes}
    trend_node = by_name.get("Daily Trend")
    structure_node = by_name.get("Net Position Change")
    trend = TrendAnalysisOut(direction=row.direction, score=row.trend_score, stage=row.trend_stage, metrics=trend_node.raw_metrics) if trend_node else None
    structure = PositionStructureAnalysisOut(direction=structure_node.direction, score=row.structure_score, metrics=structure_node.raw_metrics) if structure_node else None
    return DecisionReportOut(
        id=row.id, contract=contract.contract, variety=contract.variety, generated_at=row.generated_at,
        snapshot_time=row.snapshot_time, rule_version=row.rule_version, direction=row.direction,
        trend_stage=row.trend_stage, trend_score=row.trend_score, structure_score=row.structure_score,
        entry_score=None, risk_score=None, system_state=row.system_state, data_quality=row.data_quality,
        blocking_reasons=row.blocking_reasons, warnings=row.warnings, nodes=nodes,
        trend=trend, structure=structure, entry=None, risk=None, summary=row.summary,
    )
