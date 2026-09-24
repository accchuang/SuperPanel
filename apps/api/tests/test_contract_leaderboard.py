import unittest
from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.position import Base, PositionFeature
from app.services.analysis import get_leaderboard


class ContractLeaderboardTests(unittest.TestCase):
    def test_returns_all_disclosed_contract_seats_and_never_the_variety_aggregate(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        session_factory = sessionmaker(engine)
        day = date(2026, 9, 24)
        with session_factory() as db:
            for rank in range(1, 26):
                db.add(PositionFeature(
                    trade_date=day,
                    symbol="P2701",
                    broker=f"席位{rank}",
                    rank=rank,
                    long_position=1000 - rank,
                    long_change=rank,
                    short_position=500,
                    short_change=0,
                    net_position=500 - rank,
                    net_change=rank,
                    long_ratio=Decimal("0.1"),
                    short_ratio=Decimal("0.1"),
                    top5_concentration=Decimal("0.5"),
                    top10_concentration=Decimal("0.8"),
                ))
            db.add(PositionFeature(
                trade_date=day,
                symbol="P",
                broker="品种汇总席位",
                rank=1,
                long_position=999999,
                long_change=0,
                short_position=1,
                short_change=0,
                net_position=999998,
                net_change=0,
                long_ratio=Decimal("1"),
                short_ratio=Decimal("1"),
                top5_concentration=Decimal("1"),
                top10_concentration=Decimal("1"),
            ))
            db.commit()

            rows = get_leaderboard(db, "P2701", day)

        self.assertEqual(len(rows), 25)
        self.assertEqual({row.symbol for row in rows}, {"P2701"})
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
