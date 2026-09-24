import sys
import unittest
import tempfile
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from fetch_real_positions import clean_broker, fetch_eastmoney_contract_positions, fetch_eastmoney_dce, fetch_positions, normalize_eastmoney_contract_payload, normalize_payload
from fetch_real_positions import import_and_compute, write_csv
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from app.db.session import Base
from app.models.position import RawPosition, PositionFeature


def response(pages, value):
    result = MagicMock()
    result.json.return_value = {"success": True, "result": {"pages": pages, "data": [{
        "MEMBER_NAME_ABBR": "测试席位（代客）", "LONG_POSITION": value, "SHORT_POSITION": 2,
    }]}}
    return result


class FetchTests(unittest.TestCase):
    @patch("fetch_real_positions.requests.get")
    def test_contract_fetch_queries_the_exact_market_contract(self, get):
        response = MagicMock()
        response.json.return_value = {
            "code": 10000,
            "data": {
                "contract": "p2701", "tradeDate": "20260924",
                "longInfoList": [{"futureCompanyName": "多席位", "longNum": 120, "longChange": 5}],
                "shortInfoList": [{"futureCompanyName": "空席位", "shortNum": 70, "shortChange": 2}],
            },
        }
        get.return_value = response

        rows = fetch_eastmoney_contract_positions("P2701", date(2026, 9, 24))

        self.assertEqual({row["symbol"] for row in rows}, {"P2701"})
        params = get.call_args.kwargs["params"]
        self.assertEqual(params, {"date": "20260924", "contract": "p2701", "market": "114"})

    @patch("fetch_real_positions.fetch_eastmoney_contract_positions")
    def test_fetch_positions_uses_contract_source_without_variety_fallback(self, fetch_exact):
        fetch_exact.return_value = [{
            "date": "2026-09-24", "symbol": "P2701", "broker": "合约席位", "rank": 1,
            "long_position": 120, "long_change": 5, "short_position": 70, "short_change": 2,
        }]

        rows = fetch_positions(["P2701"], [date(2026, 9, 24)], "auto")

        self.assertEqual([row["symbol"] for row in rows], ["P2701"])
        fetch_exact.assert_called_once_with("P2701", date(2026, 9, 24))

    def test_contract_payload_merges_exact_long_and_short_seats(self):
        payload = {
            "code": 10000,
            "data": {
                "contract": "p2701",
                "tradeDate": "20260924",
                "longInfoList": [
                    {"futureCompanyName": "测试期货(代客)", "longNum": 120, "longChange": 5},
                    {"futureCompanyName": "仅多席位", "longNum": 90, "longChange": -3},
                ],
                "shortInfoList": [
                    {"futureCompanyName": "测试期货（代客）", "shortNum": 70, "shortChange": 2},
                    {"futureCompanyName": "仅空席位", "shortNum": 80, "shortChange": -4},
                ],
            },
        }

        rows = normalize_eastmoney_contract_payload(payload, "P2701", date(2026, 9, 24))

        self.assertEqual(len(rows), 3)
        merged = next(row for row in rows if row["broker"] == "测试期货")
        self.assertEqual(merged["symbol"], "P2701")
        self.assertEqual(merged["long_position"], 120)
        self.assertEqual(merged["long_change"], 5)
        self.assertEqual(merged["short_position"], 70)
        self.assertEqual(merged["short_change"], 2)

    def test_contract_payload_rejects_other_contract_and_wrong_date(self):
        payload = {
            "code": 10000,
            "data": {
                "contract": "p2705", "tradeDate": "20260924",
                "longInfoList": [{"futureCompanyName": "错合约", "longNum": 100, "longChange": 1}],
                "shortInfoList": [],
            },
        }
        self.assertEqual(normalize_eastmoney_contract_payload(payload, "P2701", date(2026, 9, 24)), [])
        payload["data"]["contract"] = "p2701"
        payload["data"]["tradeDate"] = "20260923"
        self.assertEqual(normalize_eastmoney_contract_payload(payload, "P2701", date(2026, 9, 24)), [])

    def test_normalize_payload_keeps_only_the_requested_contract(self):
        import pandas as pd

        payload = {
            "P": pd.DataFrame([
                {
                    "var": "P", "symbol": "P2701",
                    "long_party_name": "合约席位", "long_open_interest": 120,
                    "long_open_interest_chg": 5, "short_party_name": "合约席位",
                    "short_open_interest": 70, "short_open_interest_chg": 2,
                },
                {
                    "var": "P", "symbol": "P2705",
                    "long_party_name": "其他合约席位", "long_open_interest": 900,
                    "long_open_interest_chg": 30, "short_party_name": "其他合约席位",
                    "short_open_interest": 100, "short_open_interest_chg": 4,
                },
            ])
        }

        rows = normalize_payload(payload, {"P2701"}, date(2026, 9, 24))

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["symbol"], "P2701")
        self.assertEqual(rows[0]["broker"], "合约席位")
        self.assertEqual(rows[0]["long_position"], 120)

    @patch("fetch_real_positions.requests.Session")
    def test_retry_discards_partial_pages(self, session):
        session.return_value.get.side_effect = [
            response(2, 1000), requests.Timeout(), response(2, 10), response(2, 20),
        ]
        rows = fetch_eastmoney_dce(["P"], date(2026, 9, 4))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["long_position"], 30)
        self.assertEqual(rows[0]["broker"], "测试席位")

    @patch("fetch_real_positions.requests.Session")
    def test_failed_batch_raises(self, session):
        session.return_value.get.side_effect = requests.Timeout()
        with self.assertRaises(RuntimeError):
            fetch_eastmoney_dce(["Y"], date(2026, 9, 4))

    def test_missing_broker(self):
        self.assertEqual(clean_broker(None), "")
        self.assertEqual(clean_broker("本日合计"), "")
        self.assertEqual(clean_broker("总量增减"), "")

    def test_import_preserves_history_and_rolls_back_failure(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        sessions = sessionmaker(engine)
        row = {"date": "2026-09-03", "symbol": "P", "broker": "Test", "rank": 1,
               "long_position": 10, "short_position": 2, "long_change": 1, "short_change": 0}
        with tempfile.TemporaryDirectory() as directory, patch("app.db.session.engine", engine), patch("app.db.session.SessionLocal", sessions):
            path = Path(directory) / "positions.csv"
            write_csv([row], path)
            import_and_compute(path, ["P"])
            write_csv([{**row, "date": "2026-09-04"}], path)
            import_and_compute(path, ["P"])
            import_and_compute(path, ["P"])
            with sessions() as db:
                self.assertEqual(len(db.scalars(select(RawPosition)).all()), 2)
                self.assertEqual(len(db.scalars(select(PositionFeature)).all()), 2)
            with patch("app.services.features.rebuild_features", side_effect=RuntimeError("failure")):
                with self.assertRaises(RuntimeError):
                    import_and_compute(path, ["P"], replace_symbols=True)
            with sessions() as db:
                self.assertEqual(len(db.scalars(select(RawPosition)).all()), 2)
                self.assertEqual(len(db.scalars(select(PositionFeature)).all()), 2)
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
