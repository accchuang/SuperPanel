from datetime import date

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.cta import ContractInfo


DEFAULT_CONTRACTS = (
    {"variety": "P", "contract": "P2701", "exchange": "DCE", "multiplier": 10, "tick_size": 2, "last_trade_date": date(2027, 1, 15)},
    {"variety": "OI", "contract": "OI2701", "exchange": "CZCE", "multiplier": 10, "tick_size": 1, "last_trade_date": date(2027, 1, 15)},
    {"variety": "Y", "contract": "Y2701", "exchange": "DCE", "multiplier": 10, "tick_size": 2, "last_trade_date": date(2027, 1, 15)},
)


def ensure_beta_contracts() -> None:
    db = SessionLocal()
    try:
        changed = False
        for values in DEFAULT_CONTRACTS:
            contract = db.scalar(select(ContractInfo).where(ContractInfo.contract == values["contract"]))
            if contract is None:
                db.add(ContractInfo(**values, margin_rate=0, limit_ratio=0, is_active=True))
                changed = True
            elif contract.last_trade_date is None or contract.last_trade_date < date.today():
                contract.last_trade_date = values["last_trade_date"]
                changed = True
        if changed:
            db.commit()
    finally:
        db.close()
