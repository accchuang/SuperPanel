import unittest
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models.cta import ContractInfo, MarketBar
from app.models.position import PositionFeature
from app.services.cta_engine import Point, analyze_trend, backtest_contract, backtest_dates, evaluate_contract


class CtaEngineTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def add_complete_snapshot(self, db):
        contract = ContractInfo(variety="P", contract="P2701", exchange="DCE", multiplier=10, tick_size=2, last_trade_date=date(2028, 1, 15), margin_rate=0.1, limit_ratio=0.08)
        db.add(contract)
        db.flush()
        start = datetime(2026, 1, 1)
        for timeframe, count, increment, range_size in (("D1", 70, 0.5, 3.0), ("H1", 60, 0.2, 1.0), ("M30", 60, 0.1, 0.6)):
            for index in range(count):
                close = 100 + index * increment
                if timeframe == "M30" and index == count - 1:
                    close += 2
                db.add(MarketBar(contract_id=contract.id, timeframe=timeframe, close_time=start + timedelta(days=index) if timeframe == "D1" else start + timedelta(hours=index), open=close - 0.1, high=close + range_size, low=close - range_size, close=close, volume=1000, open_interest=100000, is_final=True, source="TEST"))
        for day_offset in range(5):
            db.add(PositionFeature(
                trade_date=date(2026, 3, 1) + timedelta(days=day_offset), symbol="P", broker="测试席位", rank=1,
                long_position=10000 + day_offset * 1000, long_change=1000, short_position=1000, short_change=0,
                net_position=9000 + day_offset * 1000, net_change=1000, long_ratio=Decimal("1"), short_ratio=Decimal("1"),
                top5_concentration=Decimal("0.5"), top10_concentration=Decimal("0.8"),
                consecutive_long_add_days=day_offset + 1, consecutive_long_reduce_days=0,
                consecutive_short_add_days=0, consecutive_short_reduce_days=0,
            ))
        db.commit()

    def test_incomplete_data_never_becomes_trade_ready(self):
        with self.Session() as db:
            db.add(ContractInfo(variety="P", contract="P2701", exchange="DCE", multiplier=10, tick_size=2))
            db.commit()
            report = evaluate_contract(db, "P2701")
        self.assertEqual(report.system_state, "DATA_INCOMPLETE")
        self.assertIn("D1 已收盘 Bar", report.blocking_reasons)
        self.assertIsNone(report.entry_score)

    def test_complete_aligned_snapshot_reaches_ready(self):
        with self.Session() as db:
            self.add_complete_snapshot(db)
            report = evaluate_contract(db, "P2701")
        self.assertEqual(report.system_state, "READY")
        self.assertEqual(report.direction, "LONG")
        self.assertGreaterEqual(report.trend_score or 0, 60)
        self.assertGreaterEqual(report.structure_score or 0, 55)
        self.assertIsNone(report.entry_score)
        self.assertIsNone(report.risk_score)

    def test_twenty_daily_bars_are_sufficient_for_trend_analysis(self):
        start = datetime(2026, 1, 1)
        bars = [Point(start + timedelta(days=index), 100 + index, 104 + index, 96 + index, 100 + index, 1000, 100000) for index in range(20)]
        trend, trend_node = analyze_trend(bars)
        self.assertIsNotNone(trend)
        self.assertNotEqual(trend_node.status, "UNKNOWN")

    def test_historical_backtest_uses_only_as_of_data_and_reports_forward_returns(self):
        with self.Session() as db:
            self.add_complete_snapshot(db)
            dates = backtest_dates(db, "P2701").dates
            result = backtest_contract(db, "P2701", dates[-5])

        self.assertEqual(result.as_of_date, dates[-5])
        self.assertEqual(result.report.system_state, "READY")
        self.assertEqual([item.horizon_trading_days for item in result.performance], [1, 3, 5])
        self.assertTrue(all(item.directional_return_percent is not None for item in result.performance))
        self.assertTrue(all(item.outcome == "WIN" for item in result.performance))


if __name__ == "__main__":
    unittest.main()
