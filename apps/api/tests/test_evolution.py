import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock

from app.services.evolution import get_evolution


class EvolutionTests(unittest.TestCase):
    def test_missing_broker_is_not_zero_and_sign_switch_is_preserved(self):
        dates = [date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 3)]
        rows = [
            SimpleNamespace(trade_date=dates[i], broker=broker, net_position=value)
            for i, broker, value in [(0, "A", 10), (0, "B", -5),
                                     (1, "A", -3), (2, "A", -8), (2, "B", 2)]
        ]
        db = Mock()
        db.scalars.side_effect = [
            Mock(all=Mock(return_value=list(reversed(dates)))),
            Mock(all=Mock(return_value=rows)),
        ]
        result = get_evolution(db, "RB", None, None, 30)
        brokers = {b["broker"]: b for b in result["brokers"]}
        self.assertEqual(brokers["B"]["values"], [-5, None, 2])
        self.assertEqual(brokers["A"]["change"], -18)
        self.assertEqual(result["daily"][0]["net_long"], 10)
        self.assertEqual(result["daily"][0]["net_short"], 5)
        self.assertTrue(all(d["change"] is None for d in result["daily"]))


if __name__ == "__main__":
    unittest.main()
