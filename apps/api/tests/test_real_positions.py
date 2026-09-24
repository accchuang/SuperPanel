import sys
import unittest
import tempfile
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from fetch_real_positions import clean_broker, fetch_eastmoney_dce
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
