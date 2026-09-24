import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import app.services.tqsdk_market as market_service
from app.services.tqsdk_market import (
    LIVE_INSTRUMENTS,
    TIMEFRAMES,
    build_market_quote,
    daily_bar_is_closed,
    fetch_live_quotes,
    include_trend_variety,
    instrument_from_quote,
    quote_is_live,
)


class FakeSerial:
    def __init__(self, rows):
        self.rows = rows

    def iterrows(self):
        return enumerate(self.rows)


class LiveMarketTests(unittest.TestCase):
    def test_requested_watchlist_varieties_have_tradeable_current_contracts(self):
        actual = {item["contract"]: item["tq_symbol"] for item in LIVE_INSTRUMENTS}
        self.assertEqual(len(actual), 17)
        self.assertEqual({contract: actual.get(contract) for contract in (
            "SR2701", "CF2701", "M2701", "A2611", "B2611", "V2701", "MA2610",
            "RU2701", "NR2611", "BR2611", "TA2701", "EB2611",
        )}, {
            "SR2701": "CZCE.SR701",
            "CF2701": "CZCE.CF701",
            "M2701": "DCE.m2701",
            "A2611": "DCE.a2611",
            "B2611": "DCE.b2611",
            "V2701": "DCE.v2701",
            "MA2610": "CZCE.MA610",
            "RU2701": "SHFE.ru2701",
            "NR2611": "INE.nr2611",
            "BR2611": "SHFE.br2611",
            "TA2701": "CZCE.TA701",
            "EB2611": "DCE.eb2611",
        })

    def test_watchlist_returns_every_contract_price_without_chart_history(self):
        with tempfile.TemporaryDirectory() as directory:
            quotes = []
            for index, instrument in enumerate(LIVE_INSTRUMENTS):
                quote = market_service.empty_quote(instrument, "1d")
                quote.update({
                    "last_price": 8000 + index,
                    "change_percent": index / 10,
                    "quote_time": "2026-09-23 09:01:00",
                    "bars": [{"close": 8000 + index}],
                    "price_points": [{"price": 8000 + index}],
                })
                quotes.append(quote)
            quotes[-1]["last_price"] = 9999
            payload = {
                "source": "TQSDK", "fetched_at": datetime.now(timezone.utc).isoformat(),
                "cache_age_seconds": 0, "connection_error": None, "timeframe": "1d",
                "timeframe_label": "日线", "data_mode": "LIVE", "quotes": quotes,
            }
            Path(directory, "1d.json").write_text(json.dumps(payload), encoding="utf-8")
            with patch("app.services.tqsdk_market.settings.market_snapshot_dir", directory), patch("app.services.tqsdk_market.start_live_feed"):
                result = market_service.fetch_watchlist_quotes()

        self.assertEqual(result["data_mode"], "LIVE")
        self.assertEqual([quote["contract"] for quote in result["quotes"]], [item["contract"] for item in LIVE_INSTRUMENTS])
        self.assertEqual(result["quotes"][0]["last_price"], 8000)
        self.assertEqual(result["quotes"][-1]["last_price"], 9999)
        self.assertNotIn("bars", result["quotes"][0])
        self.assertNotIn("price_points", result["quotes"][0])

    def test_market_quote_exposes_ohlc_bars_for_terminal(self):
        start = datetime(2026, 9, 8, 9, 0).timestamp() * 1_000_000_000
        rows = [
            {
                "datetime": start + index * 300 * 1_000_000_000,
                "open": 8000 + index,
                "high": 8010 + index,
                "low": 7990 + index,
                "close": 8005 + index,
                "close_oi": 100_000 + index * 100,
                "volume": 1000 + index,
            }
            for index in range(3)
        ]
        quote = SimpleNamespace(last_price=8007, pre_close=8000, volume=1002, open_interest=100200, datetime="2026-09-08 09:10:00")

        result = build_market_quote(LIVE_INSTRUMENTS[0], FakeSerial(rows), quote, "5m")

        self.assertEqual(len(result["bars"]), 3)
        self.assertEqual(result["bars"][0]["open"], 8000)
        self.assertEqual(result["bars"][1]["high"], 8011)
        self.assertEqual(result["bars"][2]["oi_change"], 100)

    def test_terminal_quote_identifies_actual_contract_trading_day_and_forming_intraday_bar(self):
        start = datetime(2026, 9, 23, 21, 0).timestamp() * 1_000_000_000
        rows = [
            {"datetime": start + index * 1800 * 1_000_000_000, "open": 8000, "high": 8010,
             "low": 7990, "close": 8005, "close_oi": 100_000, "volume": 1000}
            for index in range(2)
        ]
        quote = SimpleNamespace(last_price=8005, pre_close=8000, volume=1000, open_interest=100_000,
                                datetime="2026-09-23 21:35:00")

        result = build_market_quote(LIVE_INSTRUMENTS[0], FakeSerial(rows), quote, "30m")

        self.assertEqual(result["instrument_type"], "ACTUAL")
        self.assertEqual(result["tq_symbol"], "DCE.p2701")
        self.assertEqual(result["trading_day"], "2026-09-24")
        self.assertEqual(result["price_source"], "QUOTE")
        self.assertTrue(result["bars"][0]["is_closed"])
        self.assertFalse(result["bars"][1]["is_closed"])

    def test_terminal_quote_does_not_disguise_bar_close_as_live_quote(self):
        start = datetime(2026, 9, 23, 9, 0).timestamp() * 1_000_000_000
        rows = [{"datetime": start, "open": 8000, "high": 8010, "low": 7990,
                 "close": 8005, "close_oi": 100_000, "volume": 1000}]
        quote = SimpleNamespace(last_price=float("nan"), pre_close=8000, volume=1000,
                                open_interest=100_000, datetime="")

        result = build_market_quote(LIVE_INSTRUMENTS[0], FakeSerial(rows), quote, "30m")

        self.assertEqual(result["last_price"], 8005)
        self.assertIsNone(result["quote_time"])
        self.assertEqual(result["price_source"], "BAR_CLOSE")
        self.assertEqual(result["status"], "CLOSED")

    def test_recent_tick_without_valid_last_price_is_not_live(self):
        start = datetime.now().replace(minute=0, second=0, microsecond=0).timestamp() * 1_000_000_000
        rows = [{"datetime": start, "open": 8000, "high": 8010, "low": 7990,
                 "close": 8005, "close_oi": 100_000, "volume": 1000}]
        quote = SimpleNamespace(last_price=float("nan"), pre_close=8000, volume=1000,
                                open_interest=100_000, datetime=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

        result = build_market_quote(LIVE_INSTRUMENTS[0], FakeSerial(rows), quote, "30m")

        self.assertEqual(result["price_source"], "BAR_CLOSE")
        self.assertEqual(result["status"], "CLOSED")

    def test_expired_live_snapshot_is_not_reported_as_live(self):
        with tempfile.TemporaryDirectory() as directory:
            payload = {
                "source": "TQSDK", "fetched_at": (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat(),
                "cache_age_seconds": 0, "connection_error": None, "timeframe": "1d",
                "timeframe_label": "日线", "data_mode": "LIVE",
                "quotes": [{**market_service.empty_quote(LIVE_INSTRUMENTS[0], "1d"), "status": "LIVE"}],
            }
            Path(directory, "1d.json").write_text(json.dumps(payload), encoding="utf-8")
            with patch("app.services.tqsdk_market.settings.market_snapshot_dir", directory), patch("app.services.tqsdk_market.start_live_feed"):
                result = fetch_live_quotes("1d")

        self.assertEqual(result["data_mode"], "STATIC")
        self.assertEqual(result["quotes"][0]["status"], "DELAYED")

    def test_daily_terminal_history_keeps_at_least_sixty_trading_days(self):
        rows = []
        current = datetime(2026, 6, 1, 9, 0)
        index = 0
        while len(rows) < 65:
            if current.weekday() < 5:
                rows.append({
                    "datetime": current.timestamp() * 1_000_000_000,
                    "open": 8000 + index,
                    "high": 8010 + index,
                    "low": 7990 + index,
                    "close": 8005 + index,
                    "close_oi": 100_000 + index * 100,
                    "volume": 1000 + index,
                })
                index += 1
            current += timedelta(days=1)
        quote = SimpleNamespace(last_price=8069, pre_close=8068, volume=1, open_interest=106500, datetime="2026-08-31 09:00:00")

        result = build_market_quote(LIVE_INSTRUMENTS[0], FakeSerial(rows), quote, "1d")

        self.assertGreaterEqual(len(result["bars"]), 60)
        self.assertGreaterEqual(TIMEFRAMES["1d"]["data_length"], 70)

    def test_terminal_quote_keeps_the_latest_one_hundred_eighty_bars(self):
        start = datetime(2026, 1, 1, 9, 0)
        rows = [
            {
                "datetime": (start + timedelta(days=index)).timestamp() * 1_000_000_000,
                "open": 8000 + index,
                "high": 8010 + index,
                "low": 7990 + index,
                "close": 8005 + index,
                "close_oi": 100_000 + index,
                "volume": 1000 + index,
            }
            for index in range(220)
        ]
        quote = SimpleNamespace(last_price=8224, pre_close=8223, volume=1219, open_interest=100219, datetime="2026-08-08 09:00:00")

        result = build_market_quote(LIVE_INSTRUMENTS[0], FakeSerial(rows), quote, "1d")

        self.assertEqual(len(result["bars"]), 180)
        self.assertEqual(result["bars"][0]["open"], 8040)
        self.assertEqual(result["bars"][-1]["close"], 8224)

    def test_three_day_terminal_uses_native_bars_without_downsampling(self):
        start = datetime(2026, 1, 1, 9, 0)
        rows = [
            {
                "datetime": (start + timedelta(days=index * 3)).timestamp() * 1_000_000_000,
                "open": 8000 + index,
                "high": 8010 + index,
                "low": 7990 + index,
                "close": 8005 + index,
                "close_oi": 100_000 + index * 100,
                "volume": 1000 + index,
            }
            for index in range(75)
        ]
        quote = SimpleNamespace(last_price=8079, pre_close=8078, volume=1074, open_interest=107400, datetime="2026-08-13 09:00:00")

        result = build_market_quote(LIVE_INSTRUMENTS[0], FakeSerial(rows), quote, "3d")

        self.assertIn("3d", TIMEFRAMES)
        self.assertEqual(TIMEFRAMES["3d"]["seconds"], 3 * 86_400)
        self.assertGreaterEqual(TIMEFRAMES["3d"]["data_length"], 80)
        self.assertEqual(len(result["bars"]), 75)
        self.assertTrue(result["bars"][-2]["is_closed"])
        self.assertFalse(result["bars"][-1]["is_closed"])

    def test_market_quote_has_realtime_price_seven_oi_bars_and_price_history(self):
        start = datetime(2026, 9, 8, 9, 0).timestamp() * 1_000_000_000
        rows = [
            {"datetime": start + index * 300 * 1_000_000_000, "close": 8000 + index, "close_oi": 100_000 + index * (-100 if index % 2 else 200)}
            for index in range(10)
        ]
        quote = SimpleNamespace(
            last_price=8123, pre_close=8000, volume=456789, open_interest=101234,
            datetime=datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f"),
        )

        result = build_market_quote(LIVE_INSTRUMENTS[0], FakeSerial(rows), quote, "5m")

        self.assertEqual(result["last_price"], 8123)
        self.assertEqual(len(result["price_points"]), 10)
        self.assertEqual(len(result["oi_points"]), 7)
        self.assertTrue(any(point["change"] > 0 for point in result["oi_points"]))
        self.assertTrue(any(point["change"] < 0 for point in result["oi_points"]))
        self.assertEqual(result["status"], "LIVE")

    def test_quote_freshness_detects_closed_snapshot(self):
        now = datetime(2026, 9, 8, 15, 10)
        self.assertTrue(quote_is_live("2026-09-08 15:09:00.000000", now))
        self.assertFalse(quote_is_live("2026-09-08 15:00:00.000000", now))

    def test_daily_bar_closure_uses_trading_session_instead_of_tick_freshness(self):
        timestamp = datetime(2026, 9, 9).timestamp() * 1_000_000_000
        self.assertFalse(daily_bar_is_closed(timestamp, datetime(2026, 9, 9, 12, 0)))
        self.assertTrue(daily_bar_is_closed(timestamp, datetime(2026, 9, 9, 15, 10)))

    def test_chemical_filter_keeps_rubber_exceptions(self):
        self.assertFalse(include_trend_variety("DCE", "PP"))
        self.assertFalse(include_trend_variety("CZCE", "TA"))
        self.assertFalse(include_trend_variety("CFFEX", "IF"))
        self.assertTrue(include_trend_variety("SHFE", "RU"))
        self.assertTrue(include_trend_variety("INE", "NR"))
        self.assertTrue(include_trend_variety("SHFE", "BR"))

    def test_dynamic_contract_uses_full_delivery_year_and_rubber_name(self):
        quote = SimpleNamespace(
            exchange_id="SHFE", product_id="ru", delivery_year=2027, delivery_month=1,
            instrument_name="橡胶2701",
        )

        result = instrument_from_quote("SHFE.ru2701", quote)

        self.assertEqual(result["contract"], "RU2701")
        self.assertEqual(result["name"], "天然橡胶")
        self.assertEqual(result["sector"], "橡胶")

    def test_trend_universe_excludes_chemicals_but_keeps_rubber_trio(self):
        for variety in ("PP", "TA", "EG", "BU", "UR"):
            self.assertFalse(include_trend_variety("DCE", variety))
        for variety in ("RU", "NR", "BR"):
            self.assertTrue(include_trend_variety("SHFE", variety))
        self.assertFalse(include_trend_variety("CFFEX", "IF"))

    def test_dynamic_contract_uses_full_delivery_year_and_sector(self):
        quote = SimpleNamespace(
            exchange_id="CZCE", product_id="OI", delivery_year=2027, delivery_month=1,
            instrument_name="菜籽油701",
        )

        result = instrument_from_quote("CZCE.OI701", quote)

        self.assertEqual(result["contract"], "OI2701")
        self.assertEqual(result["name"], "菜籽油")
        self.assertEqual(result["sector"], "油脂油料")

    def test_price_history_keeps_latest_five_trading_days_and_groups_night_session(self):
        times = [
            datetime(2026, 8, 31, 9),
            datetime(2026, 9, 1, 9),
            datetime(2026, 9, 2, 9),
            datetime(2026, 9, 3, 9),
            datetime(2026, 9, 4, 9),
            datetime(2026, 9, 6, 21),
            datetime(2026, 9, 7, 9),
            datetime(2026, 9, 7, 21),
            datetime(2026, 9, 8, 9),
            datetime(2026, 9, 8, 21),
            datetime(2026, 9, 9, 9),
        ]
        rows = [
            {"datetime": value.timestamp() * 1_000_000_000, "close": 8000 + index, "close_oi": 100_000 + index}
            for index, value in enumerate(times)
        ]
        quote = SimpleNamespace(last_price=8005, pre_close=8000, volume=1, open_interest=100_005, datetime="2026-09-08 09:00:00")

        result = build_market_quote(LIVE_INSTRUMENTS[0], FakeSerial(rows), quote, "5m")

        self.assertEqual(result["price_points"][0]["time"], "2026-09-03 09:00:00")
        self.assertEqual(result["price_points"][-1]["time"], "2026-09-09 09:00:00")
        self.assertEqual(len(result["price_points"]), 8)
        self.assertIn("2026-09-06 21:00:00", [point["time"] for point in result["price_points"]])
        self.assertGreaterEqual(TIMEFRAMES["1m"]["data_length"], 1_700)

    def test_fetch_uses_persisted_snapshot_when_feed_is_offline(self):
        with tempfile.TemporaryDirectory() as directory:
            payload = {
                "source": "TQSDK", "fetched_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
                "cache_age_seconds": 0, "connection_error": None, "timeframe": "5m", "timeframe_label": "5 分钟",
                "data_mode": "STATIC", "quotes": [],
            }
            Path(directory, "5m.json").write_text(json.dumps(payload), encoding="utf-8")
            with patch("app.services.tqsdk_market.settings.market_snapshot_dir", directory), patch("app.services.tqsdk_market.start_live_feed"):
                result = fetch_live_quotes("5m")
            self.assertEqual(result["data_mode"], "STATIC")
            self.assertGreater(result["cache_age_seconds"], 7_000)


if __name__ == "__main__":
    unittest.main()
