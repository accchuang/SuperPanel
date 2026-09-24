"""Three-day price, volume, and open-interest trend screening."""

from __future__ import annotations

from typing import Any

from app.services.tqsdk_market import fetch_trend_quotes, finite_float, finite_int


LOOKBACK_DAYS = 3
ACTIVITY_AVERAGE_DAYS = 5
REGIME_DAYS = 20
REGIME_SLOPE_DAYS = 5
MIN_TOTAL_MOVE_PERCENT = 0.5
MAX_TOTAL_MOVE_PERCENT = 8.0
MIN_LEG_BALANCE = 0.25


def percent_change(first: float | int, last: float | int) -> float | None:
    if first <= 0:
        return None
    return round((last / first - 1) * 100, 2)


def activity_signal(values: list[int]) -> tuple[bool, str, float | None, float | None]:
    """Treat a monotonic three-bar rise or a latest-value average break as growth."""
    recent = values[-LOOKBACK_DAYS:]
    three_day_rising = recent[0] <= recent[1] <= recent[2] and recent[2] > recent[0]
    historical = values[:-1][-ACTIVITY_AVERAGE_DAYS:]
    baseline = round(sum(historical) / len(historical), 2) if len(historical) >= LOOKBACK_DAYS else None
    above_average = baseline is not None and values[-1] > baseline
    relative_to_average = round(values[-1] / baseline, 3) if baseline else None

    if three_day_rising and above_average:
        return True, "THREE_DAY_RISING_AND_ABOVE_AVERAGE", baseline, relative_to_average
    if three_day_rising:
        return True, "THREE_DAY_RISING", baseline, relative_to_average
    if above_average:
        return True, "ABOVE_RECENT_AVERAGE", baseline, relative_to_average
    return False, "NONE", baseline, relative_to_average


def activity_score(signal: str) -> int:
    return {
        "THREE_DAY_RISING_AND_ABOVE_AVERAGE": 20,
        "ABOVE_RECENT_AVERAGE": 16,
        "THREE_DAY_RISING": 12,
    }.get(signal, 0)


def incomplete_result(quote: dict[str, Any], available: int) -> dict[str, Any]:
    return {
        **{key: quote[key] for key in ("variety", "name", "contract", "exchange")},
        "sector": quote.get("sector", "其他"),
        "direction": "UNKNOWN",
        "short_direction": "UNKNOWN",
        "setup_state": "UNKNOWN",
        "classification": "DATA_INCOMPLETE",
        "data_quality": "INCOMPLETE",
        "is_steady": False,
        "volume_rising": False,
        "open_interest_rising": False,
        "volume_signal": "NONE",
        "open_interest_signal": "NONE",
        "volume_relative_to_average": None,
        "open_interest_relative_to_average": None,
        "three_day_return": None,
        "volume_growth": None,
        "open_interest_growth": None,
        "volume_baseline": None,
        "open_interest_baseline": None,
        "range_percent": None,
        "stability_score": None,
        "trend_score": None,
        "score_breakdown": {},
        "evidence": [],
        "warnings": [f"仅有 {available} 根完整日 K，需要 {LOOKBACK_DAYS} 根"],
        "points": [],
    }


def analyze_instrument(quote: dict[str, Any]) -> dict[str, Any]:
    completed = [bar for bar in quote.get("daily_bars", []) if bar.get("is_closed")]
    usable = []
    for bar in completed:
        close = finite_float(bar.get("close"))
        volume = finite_int(bar.get("volume"))
        open_interest = finite_int(bar.get("open_interest"))
        if close is None or close <= 0 or volume is None or volume <= 0 or open_interest is None or open_interest <= 0:
            continue
        usable.append({**bar, "close": close, "volume": volume, "open_interest": open_interest})
    if len(usable) < LOOKBACK_DAYS:
        return incomplete_result(quote, len(usable))

    bars = usable[-LOOKBACK_DAYS:]
    closes = [bar["close"] for bar in bars]
    volumes = [bar["volume"] for bar in bars]
    open_interests = [bar["open_interest"] for bar in bars]
    first_leg = percent_change(closes[0], closes[1]) or 0.0
    second_leg = percent_change(closes[1], closes[2]) or 0.0
    three_day_return = percent_change(closes[0], closes[2])

    if first_leg > 0 and second_leg > 0:
        short_direction = "UP"
    elif first_leg < 0 and second_leg < 0:
        short_direction = "DOWN"
    else:
        short_direction = "SIDEWAYS"

    larger_leg = max(abs(first_leg), abs(second_leg))
    leg_balance = min(abs(first_leg), abs(second_leg)) / larger_leg if larger_leg else 0.0
    total_move = abs(three_day_return or 0.0)
    controlled_move = MIN_TOTAL_MOVE_PERCENT <= total_move <= MAX_TOTAL_MOVE_PERCENT
    is_steady = short_direction in {"UP", "DOWN"} and leg_balance >= MIN_LEG_BALANCE and controlled_move
    volume_growth = percent_change(volumes[0], volumes[2])
    open_interest_growth = percent_change(open_interests[0], open_interests[2])
    volume_rising, volume_signal, volume_baseline, volume_relative_to_average = activity_signal([bar["volume"] for bar in usable])
    open_interest_rising, open_interest_signal, open_interest_baseline, open_interest_relative_to_average = activity_signal(
        [bar["open_interest"] for bar in usable]
    )

    high_values = [finite_float(bar.get("high")) or bar["close"] for bar in bars]
    low_values = [finite_float(bar.get("low")) or bar["close"] for bar in bars]
    range_percent = round((max(high_values) - min(low_values)) / closes[0] * 100, 2)
    direction_score = 50 if short_direction in {"UP", "DOWN"} else 0
    balance_score = 30 * min(leg_balance, 1)
    if controlled_move:
        movement_score = 20
    elif total_move < MIN_TOTAL_MOVE_PERCENT:
        movement_score = 20 * total_move / MIN_TOTAL_MOVE_PERCENT
    else:
        movement_score = max(0, 20 - (total_move - MAX_TOTAL_MOVE_PERCENT) * 2)
    stability_score = round(direction_score + balance_score + movement_score)
    all_closes = [bar["close"] for bar in usable]
    ma20 = sum(all_closes[-REGIME_DAYS:]) / REGIME_DAYS if len(all_closes) >= REGIME_DAYS else None
    prior_ma20 = (
        sum(all_closes[-REGIME_DAYS - REGIME_SLOPE_DAYS:-REGIME_SLOPE_DAYS]) / REGIME_DAYS
        if len(all_closes) >= REGIME_DAYS + REGIME_SLOPE_DAYS else None
    )
    ma20_slope = percent_change(prior_ma20, ma20) if prior_ma20 and ma20 else None
    regime_direction = "UNKNOWN"
    if ma20 is not None and ma20_slope is not None:
        if closes[-1] > ma20 and ma20_slope > 0:
            regime_direction = "UP"
        elif closes[-1] < ma20 and ma20_slope < 0:
            regime_direction = "DOWN"
        else:
            regime_direction = "NEUTRAL"
    direction = regime_direction if regime_direction in {"UP", "DOWN"} else short_direction
    price_score = 40 if regime_direction in {"UP", "DOWN"} else 0
    if short_direction == regime_direction:
        price_score += 10
    if is_steady and short_direction == regime_direction:
        price_score += 10
    volume_score = activity_score(volume_signal)
    open_interest_score = activity_score(open_interest_signal)
    trend_score = price_score + volume_score + open_interest_score

    if regime_direction == "UP":
        if short_direction == "DOWN":
            classification = "UPTREND_PULLBACK"
            setup_state = "PULLBACK"
        elif is_steady and volume_rising and open_interest_rising:
            classification = "CONFIRMED_STEADY_UP"
            setup_state = "CONTINUATION"
        elif short_direction == "UP":
            classification = "UPTREND_CONTINUATION"
            setup_state = "CONTINUATION"
        else:
            classification = "UPTREND_CONSOLIDATION"
            setup_state = "CONSOLIDATION"
    elif regime_direction == "DOWN":
        if short_direction == "UP":
            classification = "DOWNTREND_PULLBACK"
            setup_state = "PULLBACK"
        elif is_steady and volume_rising and open_interest_rising:
            classification = "CONFIRMED_STEADY_DOWN"
            setup_state = "CONTINUATION"
        elif short_direction == "DOWN":
            classification = "DOWNTREND_CONTINUATION"
            setup_state = "CONTINUATION"
        else:
            classification = "DOWNTREND_CONSOLIDATION"
            setup_state = "CONSOLIDATION"
    elif volume_rising and open_interest_rising:
        classification = "VOLUME_OI_RISING"
    elif is_steady:
        classification = "STEADY_UP" if short_direction == "UP" else "STEADY_DOWN"
    else:
        classification = "OBSERVE"
    if regime_direction not in {"UP", "DOWN"}:
        setup_state = "NEUTRAL"

    evidence = []
    warnings = []
    if regime_direction == "UP":
        evidence.append("20 日主趋势上行")
    elif regime_direction == "DOWN":
        evidence.append("20 日主趋势下行")
    if short_direction == "UP":
        evidence.append("连续两日收盘上移")
    elif short_direction == "DOWN":
        evidence.append("连续两日收盘下移")
    else:
        warnings.append("收盘价未形成连续同向运行")
    if is_steady:
        evidence.append("两段涨跌幅较均衡")
    elif short_direction in {"UP", "DOWN"} and leg_balance < MIN_LEG_BALANCE:
        warnings.append("单日波动占比过高，趋势不够平稳")
    if total_move > MAX_TOTAL_MOVE_PERCENT:
        warnings.append("三日涨跌幅偏大，关注加速后回撤风险")
    if volume_rising:
        evidence.append(
            "成交量近三日上行且高于近期均值"
            if volume_signal == "THREE_DAY_RISING_AND_ABOVE_AVERAGE"
            else "成交量近三日上行"
            if volume_signal == "THREE_DAY_RISING"
            else "成交量高于近期均值"
        )
    else:
        warnings.append("成交量未上行且未高于近期均值")
    if open_interest_rising:
        evidence.append(
            "持仓量近三日上行且高于近期均值"
            if open_interest_signal == "THREE_DAY_RISING_AND_ABOVE_AVERAGE"
            else "持仓量近三日上行"
            if open_interest_signal == "THREE_DAY_RISING"
            else "持仓量高于近期均值"
        )
    else:
        warnings.append("持仓量未上行且未高于近期均值")
    if regime_direction == "UP" and short_direction == "DOWN":
        warnings.append("局部三日回踩，主趋势仍上行")
    elif regime_direction == "DOWN" and short_direction == "UP":
        warnings.append("局部三日反弹，主趋势仍下行")

    return {
        **{key: quote[key] for key in ("variety", "name", "contract", "exchange")},
        "sector": quote.get("sector", "其他"),
        "direction": direction,
        "short_direction": short_direction,
        "setup_state": setup_state,
        "classification": classification,
        "data_quality": "COMPLETE",
        "is_steady": is_steady,
        "volume_rising": volume_rising,
        "open_interest_rising": open_interest_rising,
        "volume_signal": volume_signal,
        "open_interest_signal": open_interest_signal,
        "volume_relative_to_average": volume_relative_to_average,
        "open_interest_relative_to_average": open_interest_relative_to_average,
        "three_day_return": three_day_return,
        "volume_growth": volume_growth,
        "open_interest_growth": open_interest_growth,
        "volume_baseline": volume_baseline,
        "open_interest_baseline": open_interest_baseline,
        "range_percent": range_percent,
        "stability_score": stability_score,
        "trend_score": trend_score,
        "score_breakdown": {
            "price_structure": price_score,
            "volume": volume_score,
            "open_interest": open_interest_score,
        },
        "evidence": evidence,
        "warnings": warnings,
        "points": [
            {
                "date": str(bar["time"])[:10],
                "close": bar["close"],
                "volume": bar["volume"],
                "open_interest": bar["open_interest"],
            }
            for bar in bars
        ],
    }


def build_trend_tracker(snapshot: dict[str, Any]) -> dict[str, Any]:
    instruments = [analyze_instrument(quote) for quote in snapshot.get("quotes", [])]
    instruments.sort(
        key=lambda item: (
            item["data_quality"] == "COMPLETE",
            item["volume_rising"] and item["open_interest_rising"],
            item["is_steady"],
            item["stability_score"] or 0,
            abs(item["three_day_return"] or 0),
        ),
        reverse=True,
    )
    sector_counts: dict[str, int] = {}
    for item in instruments:
        sector_counts[item["sector"]] = sector_counts.get(item["sector"], 0) + 1
    return {
        "source": snapshot.get("source", "TQSDK"),
        "fetched_at": snapshot["fetched_at"],
        "cache_age_seconds": snapshot.get("cache_age_seconds"),
        "data_mode": snapshot.get("data_mode", "WAITING"),
        "connection_error": snapshot.get("connection_error"),
        "universe_name": snapshot.get("universe_name", "国内商品主力"),
        "universe_size": snapshot.get("universe_size", len(instruments)),
        "commodity_count": snapshot.get("commodity_count", len(instruments)),
        "excluded_chemical_count": snapshot.get("excluded_chemical_count", 0),
        "excluded_varieties": snapshot.get("excluded_varieties", []),
        "rubber_exceptions": snapshot.get("rubber_exceptions", ["BR", "NR", "RU"]),
        "sector_counts": sector_counts,
        "lookback_days": LOOKBACK_DAYS,
        "completed_only": True,
        "instruments": instruments,
    }


def fetch_trend_tracker() -> dict[str, Any]:
    return build_trend_tracker(fetch_trend_quotes())
