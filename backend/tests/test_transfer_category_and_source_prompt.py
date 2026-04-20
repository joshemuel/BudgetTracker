from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.telegram import _handle_text
from app.db.models import AppState, Source, Transaction, User
from app.db.session import SessionLocal


def _hard_cleanup_sources(*names: str) -> None:
    with SessionLocal() as db:
        rows = db.query(Source).filter(Source.name.in_(list(names))).all()
        if not rows:
            return
        ids = [s.id for s in rows]
        db.query(Transaction).filter(Transaction.source_id.in_(ids)).delete(synchronize_session=False)
        db.query(Source).filter(Source.id.in_(ids)).delete(synchronize_session=False)
        db.commit()


def _clear_pending_source_state(user_id: int) -> None:
    with SessionLocal() as db:
        row = db.query(AppState).filter_by(key=f"PENDING_SOURCE_CREATE:{user_id}").one_or_none()
        if row is not None:
            db.delete(row)
            db.commit()


def test_transfer_endpoint_uses_top_up_for_regular_wallet_transfer(auth_client: TestClient):
    from_name = f"pytest_from_{uuid4().hex[:8]}"
    to_name = f"pytest_to_{uuid4().hex[:8]}"
    _hard_cleanup_sources(from_name, to_name)
    created_from = auth_client.post("/sources", json={"name": from_name, "starting_balance": "100000"})
    created_to = auth_client.post("/sources", json={"name": to_name, "starting_balance": "0"})
    assert created_from.status_code == 201, created_from.text
    assert created_to.status_code == 201, created_to.text
    try:
        r = auth_client.post(
            "/transactions/transfer",
            json={
                "occurred_at": "2026-04-18T10:00:00Z",
                "amount": "50000",
                "from_source_id": created_from.json()["id"],
                "to_source_id": created_to.json()["id"],
            },
        )
        assert r.status_code == 201, r.text
        rows = r.json()
        assert len(rows) == 2
        assert all(row["category_name"] == "Top-up" for row in rows)
    finally:
        _hard_cleanup_sources(from_name, to_name)


def test_unknown_source_in_top_up_message_prompts_creation(auth_client: TestClient, monkeypatch):
    sent: list[str] = []
    unknown_source = f"XSrc{uuid4().hex[:8]}"
    _hard_cleanup_sources(unknown_source)

    active_sources = auth_client.get("/sources").json()
    assert active_sources, "expected at least one active source"
    from_source = active_sources[0]["name"]

    def fake_classify(text: str, categories: list[str], sources: list[str]) -> dict[str, str]:
        return {"type": "log"}

    def fake_extract(
        text: str,
        categories: list[str],
        sources: list[str],
        today_ddmmyyyy: str,
    ) -> list[dict[str, object]]:
        return [
            {
                "type": "Expense",
                "category": "Untrackable",
                "amount": 50000,
                "source": from_source,
                "description": f"Transfer to {unknown_source}",
                "date": today_ddmmyyyy,
                "time": None,
                "is_internal": True,
            },
            {
                "type": "Income",
                "category": "Untrackable",
                "amount": 50000,
                "source": unknown_source,
                "description": f"Transfer from {from_source}",
                "date": today_ddmmyyyy,
                "time": None,
                "is_internal": True,
            },
        ]

    def fake_send_message(chat_id: int | str, text: str, reply_markup: dict | None = None) -> None:
        sent.append(text)

    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)
    monkeypatch.setattr("app.services.intent.classify", fake_classify)
    monkeypatch.setattr("app.services.intent.extract_financial", fake_extract)

    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            _handle_text(db, user, "test-chat", f"Top up {unknown_source} for 50k")

            pending = db.query(AppState).filter_by(key=f"PENDING_SOURCE_CREATE:{user.id}").one_or_none()
            assert pending is not None
            assert pending.value.get("source_name") == unknown_source

        assert sent, "expected bot prompt"
        assert f"couldn't find source '{unknown_source}'" in sent[-1]

        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            _handle_text(db, user, "test-chat", "yes")

            pending = db.query(AppState).filter_by(key=f"PENDING_SOURCE_CREATE:{user.id}").one_or_none()
            assert pending is None

        srcs = auth_client.get("/sources").json()
        created_source = next((s for s in srcs if s["name"] == unknown_source), None)
        assert created_source is not None

        txs = auth_client.get("/transactions?limit=20").json()["items"]
        tx = next((t for t in txs if t["source_name"] == unknown_source), None)
        assert tx is not None
        assert Decimal(tx["amount"]) == Decimal("50000")

        assert any(msg == f"Created source '{unknown_source}'. Logging it now." for msg in sent)
    finally:
        _clear_pending_source_state(user_id)
        _hard_cleanup_sources(unknown_source)
