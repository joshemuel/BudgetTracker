from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app.api import (
    auth,
    budgets,
    categories,
    sources,
    stats,
    subscriptions,
    telegram,
    transactions,
)
from app.db.session import get_engine
from app.services import scheduler, telegram_poller


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.start()
    try:
        yield
    finally:
        scheduler.stop()


app = FastAPI(title="BudgetTracker API", version="0.1.0", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(sources.router)
app.include_router(categories.router)
app.include_router(budgets.router)
app.include_router(transactions.router)
app.include_router(stats.router)
app.include_router(subscriptions.router)
app.include_router(telegram.router)


@app.get("/healthz")
def healthz() -> dict:
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "db": db_ok}
