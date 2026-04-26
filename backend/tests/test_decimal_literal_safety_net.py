"""Regression test: chat-path amounts must respect decimal literals in the
source text, even when the LLM over-scales them."""

from decimal import Decimal
from uuid import uuid4

from app.api.telegram import _handle_text
from app.db.models import Source, Transaction, User
from app.db.session import SessionLocal


def _cleanup_sources(*names: str) -> None:
    with SessionLocal() as db:
        rows = db.query(Source).filter(Source.name.in_(list(names))).all()
        if not rows:
            return
        ids = [r.id for r in rows]
        db.query(Transaction).filter(Transaction.source_id.in_(ids)).delete(
            synchronize_session=False
        )
        for row in rows:
            db.delete(row)
        db.commit()


def test_handle_text_corrects_llm_inflated_decimal(auth_client, monkeypatch):
    """LLM returns 8500 for "8.50" — wiring must override back to 8.50."""
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    suffix = uuid4().hex[:8]
    src_name = f"pytest_decimal_safety_{suffix}"
    _cleanup_sources(src_name)

    def fake_send_message(chat_id, text, reply_markup=None):
        return None

    def fake_classify(text, categories, sources):
        return {"type": "log"}

    captured_amount: list[object] = []

    def fake_extract(text, categories, sources, today_ddmmyyyy):
        # Simulate the bug: Gemini scales "8.50" up to 8500.
        item = {
            "type": "Expense",
            "category": "Food",
            "amount": 8500,
            "source": src_name,
            "description": "Decimal Safety Net",
            "date": today_ddmmyyyy,
            "time": None,
        }
        captured_amount.append(item["amount"])
        return [item]

    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)
    monkeypatch.setattr("app.services.intent.classify", fake_classify)
    monkeypatch.setattr("app.services.intent.extract_financial", fake_extract)

    src = auth_client.post(
        "/sources",
        json={"name": src_name, "starting_balance": "0", "currency": "SGD"},
    )
    assert src.status_code == 201, src.text

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            _handle_text(db, user, "test-chat", "I spent 8.50 on food")

        txs = auth_client.get("/transactions?limit=200").json()["items"]
        hit = next((t for t in txs if t.get("description") == "Decimal Safety Net"), None)
        assert hit is not None
        # Amount must have been corrected from 8500 back to 8.50.
        assert Decimal(str(hit["amount"])) == Decimal("8.50")
        # Sanity: the LLM really did try to inflate.
        assert captured_amount == [8500]
    finally:
        _cleanup_sources(src_name)
