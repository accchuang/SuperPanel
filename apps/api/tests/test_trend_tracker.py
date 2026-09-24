import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.services.trend_backtest import backtest_at, backtest_dates, backtest_summary
from app.services.trend_tracker import analyze_instrument, build_trend_tracker


def quote(contract, closes, volumes, open_interests, closed=None):
    return {
        "variety": contract.rstrip("0123456789"),
        "name": contract,
        "contract": contract,
        "exchange": "DCE",
        "daily_bars": [
            {
                "time": f"2026-09-0{index + 1} 00:00:00",
                "open": close - 5,
                "high": close + 15,
                "low": close - 15,
                "close": close,
                "volume": volume,
                "open_interest": open_interest,
                "is_closed": (closed or [True] * len(closes))[index],
            }
            for index, (close, volume, open_interest) in enumerate(zip(closes, volumes, open_interests))
        ],
    }


class TrendTrackerTests(unittest.TestCase):
    def test_steady_uptrend_with_volume_and_oi_growth_is_confirmed(self):
        result = analyze_instrument(
            quote(
                "Y2701",
                [100 + index * 0.8 for index in range(30)],
                [1000 + index * 80 for index in range(30)],
                [5000 + index * 40 for index in range(30)],
            )
        )

        self.assertEqual(result["direction"], "UP")
        self.assertTrue(result["is_steady"])
        self.assertTrue(result["volume_rising"])
        self.assertTrue(result["open_interest_rising"])
        self.assertEqual(result["classification"], "CONFIRMED_STEADY_UP")
        self.assertEqual(len(result["points"]), 3)

    def test_choppy_prices_are_not_marked_as_steady(self):
        result = analyze_instrument(quote("P2701", [100, 103, 101], [1000, 1100, 1200], [5000, 5050, 5100]))

        self.assertEqual(result["direction"], "SIDEWAYS")
        self.assertFalse(result["is_steady"])
        self.assertEqual(result["classification"], "VOLUME_OI_RISING")

    def test_latest_activity_above_recent_average_counts_as_growth(self):
        result = analyze_instrument(
            quote(
                "P2701",
                [100, 101, 102, 103, 104, 105],
                [1000, 900, 1100, 1200, 1600, 1400],
                [5000, 4900, 5100, 5200, 5600, 5400],
            )
        )

        self.assertTrue(result["volume_rising"])
        self.assertTrue(result["open_interest_rising"])
        self.assertEqual(result["volume_signal"], "ABOVE_RECENT_AVERAGE")
        self.assertEqual(result["open_interest_signal"], "ABOVE_RECENT_AVERAGE")

    def test_active_daily_bar_is_excluded(self):
        result = analyze_instrument(
            quote("OI2701", [100, 101, 102, 90], [1000, 1100, 1200, 10], [5000, 5050, 5100, 4900], [True, True, True, False])
        )

        self.assertEqual(result["direction"], "UP")
        self.assertEqual(result["points"][-1]["close"], 102)

    def test_incomplete_history_stays_visible_with_quality_flag(self):
        result = analyze_instrument(quote("LH2611", [100, 101], [1000, 1100], [5000, 5050]))

        self.assertEqual(result["classification"], "DATA_INCOMPLETE")
        self.assertEqual(result["data_quality"], "INCOMPLETE")
        self.assertIsNone(result["stability_score"])

    def test_confirmed_instrument_is_ranked_first(self):
        snapshot = {
            "source": "TQSDK",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "cache_age_seconds": 0,
            "data_mode": "STATIC",
            "universe_name": "国内商品主力",
            "universe_size": 2,
            "commodity_count": 3,
            "excluded_chemical_count": 1,
            "excluded_varieties": ["PP"],
            "rubber_exceptions": ["BR", "NR", "RU"],
            "quotes": [
                quote("P2701", [100, 103, 101], [1000, 900, 800], [5000, 4900, 4800]),
                quote("Y2701", [100, 101, 102], [1000, 1100, 1200], [5000, 5050, 5100]),
            ],
        }

        result = build_trend_tracker(snapshot)

        self.assertEqual(result["instruments"][0]["contract"], "Y2701")
        self.assertEqual(result["universe_size"], 2)
        self.assertEqual(result["excluded_varieties"], ["PP"])

    def test_historical_trend_backtest_uses_same_signal_and_forward_returns(self):
        start = datetime(2026, 1, 1)
        history_quote = quote(
            "P2701",
            [100 + index for index in range(30)],
            [1000 + index * 100 for index in range(30)],
            [5000 + index * 50 for index in range(30)],
        )
        history_quote.update({
            "name": "棕榈油",
            "sector": "油脂油料",
            "daily_bars": [
                {
                    "time": (start + timedelta(days=index)).isoformat(),
                    "open": 99 + index,
                    "high": 102 + index,
                    "low": 98 + index,
                    "close": 100 + index,
                    "volume": 1000 + index * 100,
                    "open_interest": 5000 + index * 50,
                    "is_closed": True,
                }
                for index in range(30)
            ],
        })
        snapshot = {"source": "TEST", "fetched_at": datetime.now(timezone.utc), "data_mode": "STATIC", "history_days": 30, "quotes": [history_quote]}
        with patch("app.services.trend_backtest.fetch_trend_history", return_value=snapshot):
            dates = backtest_dates("P")["dates"]
            result = backtest_at("P", dates[0])
            summary = backtest_summary("P")

        self.assertTrue(result["signal_active"])
        self.assertEqual(result["signal"]["trend_score"], 100)
        self.assertTrue(all(item["outcome"] == "WIN" for item in result["performance"]))
        self.assertGreater(summary["volume_oi_confirmed_count"], 0)

    def test_short_pullback_does_not_reverse_an_upward_twenty_day_trend(self):
        closes = [100 + index for index in range(30)]
        closes[-3:] = [127, 126, 125]
        result = analyze_instrument(quote("ZN2610", closes, [1000 + index * 10 for index in range(30)], [5000 + index * 5 for index in range(30)]))

        self.assertEqual(result["direction"], "UP")
        self.assertEqual(result["short_direction"], "DOWN")
        self.assertEqual(result["classification"], "UPTREND_PULLBACK")


if __name__ == "__main__":
    unittest.main()
