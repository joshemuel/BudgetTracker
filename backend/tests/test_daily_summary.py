from datetime import datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import AppState, User
from app.services import daily_summary
from app.services.parse import tz


def _clear_cache(db: Session, user_id: int) -> None:
    state = db.get(AppState, daily_summary.STATE_KEY.format(user_id=user_id))
    if state is not None:
        db.delete(state)
        db.commit()


def test_summary_endpoint_uses_llm_and_caches(
    auth_client: TestClient, db: Session, monkeypatch
):
    user = db.query(User).filter_by(username="josia").one()
    _clear_cache(db, user.id)

    calls = {"n": 0}
    canned = "You spent Rp 12.345 over the last 7 days, mostly on pytest_summary_cat."

    def fake_call(prompt: str, json_mode: bool = True, timeout: float = 45.0) -> str:
        calls["n"] += 1
        return canned

    monkeypatch.setattr(daily_summary.llm, "call", fake_call)

    # Seed a spend dated today so there is something for the model to summarise.
    cat = auth_client.post("/categories", json={"name": "pytest_summary_cat"})
    assert cat.status_code in (201, 409), cat.text
    cat_id = next(
        c["id"] for c in auth_client.get("/categories").json()
        if c["name"] == "pytest_summary_cat"
    )
    source_id = auth_client.get("/sources").json()[0]["id"]
    occurred = datetime.now(tz()).strftime("%Y-%m-%dT10:00:00Z")
    tx = auth_client.post(
        "/transactions",
        json={
            "occurred_at": occurred,
            "type": "expense",
            "category_id": cat_id,
            "amount": "12345",
            "source_id": source_id,
            "description": "pytest-summary",
        },
    )
    assert tx.status_code == 201, tx.text
    tx_id = tx.json()["id"]

    try:
        _clear_cache(db, user.id)  # ensure the seeded spend is reflected, not a stale row
        r1 = auth_client.get("/stats/summary")
        assert r1.status_code == 200, r1.text
        body1 = r1.json()
        assert body1["text"] == canned
        assert body1["generated_on"] == datetime.now(tz()).date().isoformat()
        first = calls["n"]
        assert first >= 1

        # Second request is served from the day's cache — no extra LLM call.
        r2 = auth_client.get("/stats/summary")
        assert r2.status_code == 200, r2.text
        assert r2.json()["text"] == canned
        assert calls["n"] == first
    finally:
        auth_client.delete(f"/transactions/{tx_id}")
        auth_client.delete(f"/categories/{cat_id}")
        _clear_cache(db, user.id)


def test_summary_falls_back_when_llm_unavailable(db: Session, monkeypatch):
    user = db.query(User).filter_by(username="josia").one()
    _clear_cache(db, user.id)

    def boom(prompt: str, json_mode: bool = True, timeout: float = 45.0) -> str:
        raise RuntimeError("model offline")

    monkeypatch.setattr(daily_summary.llm, "call", boom)

    result = daily_summary.get_or_build(db, user)
    assert result["text"]  # never empty
    # Deterministic fallback wording (with or without recent spend).
    assert "last 7 days" in result["text"].lower()
    _clear_cache(db, user.id)


def test_fallback_text_shapes():
    # No spend.
    assert daily_summary._fallback_text("IDR", Decimal("0"), Decimal("0"), []) == (
        "No tracked spending in the last 7 days."
    )
    # With a top category and a notable week-over-week rise.
    text = daily_summary._fallback_text(
        "IDR", Decimal("150000"), Decimal("100000"), [("Groceries", Decimal("90000"))]
    )
    assert "Rp 150.000" in text
    assert "Groceries" in text
    assert "up 50%" in text
