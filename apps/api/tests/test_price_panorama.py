import unittest
from datetime import datetime
from types import SimpleNamespace

from app.services.price_panorama import build_panorama_quote
from app.services.tqsdk_market import discover_commodity_universe, discover_trend_universe


def daily_row(day: str, close: float):
    timestamp = int(datetime.fromisoformat(day if "T" in day else f"{day}T00:00:00").timestamp() * 1_000_000_000)
    return {"datetime": timestamp, "close": close}


class FakeSerial:
    def __init__(self, rows):
        self.rows = rows

    def iterrows(self):
        return enumerate(self.rows)


class PricePanoramaTests(unittest.TestCase):
    def setUp(self):
        self.instrument = {
            "variety": "MA", "name": "甲醇", "contract": "MA2610", "exchange": "CZCE", "sector": "化工", "tq_symbol": "CZCE.MA610",
        }

    def test_forming_day_uses_quote_after_five_completed_closes(self):
        serial = FakeSerial([
            daily_row("2026-09-17", 100), daily_row("2026-09-18", 101), daily_row("2026-09-21", 102),
            daily_row("2026-09-22", 103), daily_row("2026-09-23", 104), daily_row("2026-09-24", 120),
        ])
        quote = SimpleNamespace(last_price=106, pre_close=104, datetime="2026-09-24 14:00:00")

        result = build_panorama_quote(self.instrument, serial, quote, now=datetime(2026, 9, 24, 14, 0, 1))

        self.assertEqual(result["price_history"], [100, 101, 102, 103, 104, 106])
        self.assertEqual(result["five_day_change_percent"], 6.0)
        self.assertEqual(result["last_price"], 106)

    def test_completed_day_uses_six_completed_closes_without_duplicate_quote(self):
        serial = FakeSerial([
            daily_row("2026-09-16", 90), daily_row("2026-09-17", 100), daily_row("2026-09-18", 101),
            daily_row("2026-09-21", 102), daily_row("2026-09-22", 103), daily_row("2026-09-23", 104), daily_row("2026-09-24", 108),
        ])
        quote = SimpleNamespace(last_price=108, pre_close=104, datetime="2026-09-24 15:10:00")

        result = build_panorama_quote(self.instrument, serial, quote, now=datetime(2026, 9, 24, 15, 10, 1))

        self.assertEqual(result["price_history"], [100, 101, 102, 103, 104, 108])
        self.assertEqual(result["five_day_change_percent"], 8.0)

    def test_night_session_daily_bar_uses_trading_day_not_calendar_day(self):
        serial = FakeSerial([
            daily_row("2026-09-16", 90), daily_row("2026-09-17", 100), daily_row("2026-09-18", 101),
            daily_row("2026-09-21", 102), daily_row("2026-09-22", 103), daily_row("2026-09-23", 104),
            daily_row("2026-09-23T21:00:00", 108),
        ])
        quote = SimpleNamespace(last_price=108, pre_close=104, datetime="2026-09-24 15:10:00")

        result = build_panorama_quote(self.instrument, serial, quote, now=datetime(2026, 9, 24, 15, 10, 1))

        self.assertEqual(result["price_history"], [100, 101, 102, 103, 104, 108])
        self.assertEqual(result["five_day_change_percent"], 8.0)

    def test_full_commodity_universe_includes_chemicals_without_changing_trend_filter(self):
        class FakeApi:
            def query_cont_quotes(self):
                return ["CZCE.MA610", "DCE.p2701"]

            def get_quote(self, symbol):
                exchange, product = symbol.split(".")
                variety = "MA" if product.upper().startswith("MA") else "P"
                return SimpleNamespace(
                    exchange_id=exchange, product_id=variety, delivery_year=2026 if variety == "MA" else 2027,
                    delivery_month=10 if variety == "MA" else 1, instrument_name="甲醇" if variety == "MA" else "棕榈油",
                )

        full = discover_commodity_universe(FakeApi())
        filtered, excluded = discover_trend_universe(FakeApi())

        self.assertEqual({item["variety"] for item in full}, {"MA", "P"})
        self.assertEqual(next(item["sector"] for item in full if item["variety"] == "MA"), "化工")
        self.assertEqual([item["variety"] for item in filtered], ["P"])
        self.assertEqual(excluded, ["MA"])


if __name__ == "__main__":
    unittest.main()
