from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.cta import ContractInfo, DecisionReport, HumanDecision, MarketBar
from app.schemas.cta import (
    BacktestDatesOut,
    BarIn,
    ContractConfigIn,
    ContractOut,
    DecisionReportOut,
    HistoricalBacktestOut,
    HumanDecisionIn,
    HumanDecisionOut,
)
from app.services.cta_engine import backtest_contract, backtest_dates, contract_to_out, evaluate_contract, report_from_row, save_report

router = APIRouter(prefix="/cta", tags=["cta"])


@router.get("/contracts", response_model=list[ContractOut])
def contracts(db: Session = Depends(get_db)):
    return [contract_to_out(row) for row in db.scalars(select(ContractInfo).where(ContractInfo.is_active.is_(True)).order_by(ContractInfo.variety, ContractInfo.contract)).all()]


@router.put("/contracts/{contract_code}", response_model=ContractOut)
def upsert_contract(contract_code: str, payload: ContractConfigIn, db: Session = Depends(get_db)):
    if payload.contract.upper() != contract_code.upper():
        raise HTTPException(status_code=422, detail="contract path and payload must match")
    row = db.scalar(select(ContractInfo).where(ContractInfo.contract == contract_code.upper()))
    values = payload.model_dump()
    values["variety"] = values["variety"].upper()
    values["contract"] = values["contract"].upper()
    if row is None:
        row = ContractInfo(**values)
        db.add(row)
    else:
        for key, value in values.items():
            setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return contract_to_out(row)


@router.post("/bars", status_code=201)
def upsert_bar(payload: BarIn, db: Session = Depends(get_db)):
    contract = db.scalar(select(ContractInfo).where(ContractInfo.contract == payload.contract.upper()))
    if contract is None:
        raise HTTPException(status_code=404, detail="CTA contract configuration not found")
    row = db.scalar(select(MarketBar).where(
        MarketBar.contract_id == contract.id,
        MarketBar.timeframe == payload.timeframe,
        MarketBar.close_time == payload.close_time,
    ))
    values = payload.model_dump(exclude={"contract"})
    if row is None:
        row = MarketBar(contract_id=contract.id, **values)
        db.add(row)
    else:
        for key, value in values.items():
            setattr(row, key, value)
    db.commit()
    return {"contract": contract.contract, "timeframe": payload.timeframe, "close_time": payload.close_time}


@router.post("/evaluate", response_model=DecisionReportOut)
def evaluate(contract: str = Query(...), db: Session = Depends(get_db)):
    try:
        report = evaluate_contract(db, contract)
        row = save_report(db, report)
        return report.model_copy(update={"id": row.id})
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/backtest/dates", response_model=BacktestDatesOut)
def available_backtest_dates(contract: str = Query(...), db: Session = Depends(get_db)):
    try:
        return backtest_dates(db, contract)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/backtest", response_model=HistoricalBacktestOut)
def backtest(contract: str = Query(...), as_of: date = Query(...), db: Session = Depends(get_db)):
    try:
        return backtest_contract(db, contract, as_of)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/reports/latest", response_model=DecisionReportOut | None)
def latest_report(contract: str = Query(...), db: Session = Depends(get_db)):
    config = db.scalar(select(ContractInfo).where(ContractInfo.contract == contract.upper()))
    if config is None:
        raise HTTPException(status_code=404, detail="CTA contract configuration not found")
    row = db.scalar(select(DecisionReport).where(DecisionReport.contract_id == config.id).order_by(DecisionReport.generated_at.desc()))
    return report_from_row(row, config) if row else None


@router.post("/reports/{report_id}/human-decisions", response_model=HumanDecisionOut, status_code=201)
def record_human_decision(report_id: str, payload: HumanDecisionIn, db: Session = Depends(get_db)):
    if db.get(DecisionReport, report_id) is None:
        raise HTTPException(status_code=404, detail="Decision report not found")
    row = HumanDecision(report_id=report_id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/reports/{report_id}/human-decisions", response_model=list[HumanDecisionOut])
def human_decisions(report_id: str, db: Session = Depends(get_db)):
    return db.scalars(select(HumanDecision).where(HumanDecision.report_id == report_id).order_by(HumanDecision.decided_at.desc())).all()
