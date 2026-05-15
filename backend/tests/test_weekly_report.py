from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.db.models import AppState, Category, Source, Transaction, User
from app.db.session import SessionLocal
from app.services import fx, scheduler, weekly_report


def _seed_fx_rates(db) -> None:
    payload = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "rates": {
            "USD": "1",
            "IDR": "16000",
            "SGD": "1",
            "JPY": "150",
            "AUD": "1.5",
            "TWD": "32",
        },
    }
    state = db.get(AppState, fx.STATE_KEY)
    if state is None:
        db.add(AppState(key=fx.STATE_KEY, value=payload))
    else:
        state.value = payload
    db.commit()


def test_build_weekly_report_includes_daily_and_category_charts(auth_client):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    suffix = uuid4().hex[:8]
    category_name = f"pytest_weekly_cat_{suffix}"
    source_name = f"pytest_weekly_src_{suffix}"

    created_cat = auth_client.post("/categories", json={"name": category_name})
    assert created_cat.status_code == 201, created_cat.text
    category = created_cat.json()
    created_source = auth_client.post(
        "/sources",
        json={"name": source_name, "starting_balance": "0", "currency": "IDR"},
    )
    assert created_source.status_code == 201, created_source.text
    source = created_source.json()

    tx_id: int | None = None
    try:
        with SessionLocal() as db:
            _seed_fx_rates(db)
            tx = Transaction(
                user_id=user_id,
                occurred_at=datetime(2026, 5, 6, 12, 0, tzinfo=timezone.utc),
                type="expense",
                category_id=int(category["id"]),
                amount=Decimal("125000"),
                source_id=int(source["id"]),
                description="weekly report regression",
                is_internal=False,
            )
            db.add(tx)
            db.commit()
            tx_id = tx.id

            user = db.query(User).filter_by(id=user_id).one()
            report = weekly_report.build_weekly_report(
                db,
                user,
                now=datetime(2026, 5, 10, 18, 0, tzinfo=ZoneInfo("Asia/Jakarta")),
            )

        assert "Weekly report" in report
        assert "Daily spending" in report
        assert "Category spending" in report
        assert category_name in report
        assert "125.000" in report
    finally:
        with SessionLocal() as db:
            if tx_id is not None:
                db.query(Transaction).filter(Transaction.id == tx_id).delete(synchronize_session=False)
            db.query(Source).filter(Source.id == source["id"]).delete(synchronize_session=False)
            db.query(Category).filter(Category.id == category["id"]).delete(synchronize_session=False)
            db.commit()


def test_scheduler_registers_weekly_report_job(monkeypatch):
    scheduler.stop()
    jobs: list[dict] = []

    class FakeScheduler:
        def __init__(self, timezone):
            self.timezone = timezone

        def add_job(self, func, trigger, id, replace_existing, max_instances, coalesce):
            jobs.append(
                {
                    "func": func,
                    "trigger": trigger,
                    "id": id,
                    "replace_existing": replace_existing,
                    "max_instances": max_instances,
                    "coalesce": coalesce,
                }
            )

        def start(self):
            return None

        def shutdown(self, wait=False):
            return None

    monkeypatch.setattr(scheduler, "BackgroundScheduler", FakeScheduler)
    try:
        scheduler.start()
        assert any(job["id"] == "weekly_reports" for job in jobs)
    finally:
        scheduler.stop()
