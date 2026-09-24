from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.cta_routes import router as cta_router
from app.api.routes import router
from app.core.config import settings
from app.db.session import Base, engine
from app.models import cta as cta_models
from app.services.cta_seed import ensure_beta_contracts
from app.services.tqsdk_market import start_live_feed, start_panorama_feed, start_trend_feed, stop_market_feeds

app = FastAPI(title="Futures Intelligence Dashboard API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_beta_contracts()
    start_live_feed()
    start_trend_feed()
    start_panorama_feed()


@app.on_event("shutdown")
def on_shutdown() -> None:
    stop_market_feeds()


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(router)
app.include_router(cta_router)
