from uuid import uuid4

from app.api.telegram import _handle_text
from app.db.models import AppState, Source, Transaction, User
from app.db.session import SessionLocal


def _cleanup_sources(*names: str) -> None:
    with SessionLocal() as db:
        rows = db.query(Source).filter(Source.name.in_(list(names))).all()
        if not rows:
            return
        ids = [r.id for r in rows]
        db.query(Transaction).filter(Transaction.source_id.in_(ids)).delete(synchronize_session=False)
        for row in rows:
            db.delete(row)
        db.commit()


def _clear_pending_choice_state(user_id: int) -> None:
    with SessionLocal() as db:
        row = db.query(AppState).filter_by(key=f"PENDING_SOURCE_CHOICE:{user_id}").one_or_none()
        if row is not None:
            db.delete(row)
            db.commit()


def test_credit_source_disambiguation_prompts_when_multiple_cards(auth_client, monkeypatch):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    suffix = uuid4().hex[:8]
    card_one = f"pytest_cc_one_{suffix}"
    card_two = f"pytest_cc_two_{suffix}"
    _cleanup_sources(card_one, card_two)

    sent: list[str] = []

    def fake_send_message(chat_id: int | str, text: str, reply_markup: dict | None = None) -> None:
        sent.append(text)

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
                "category": "Food",
                "amount": 50000,
                "source": "credit card",
                "description": "Dinner",
                "date": today_ddmmyyyy,
                "time": None,
            }
        ]

    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)
    monkeypatch.setattr("app.services.intent.classify", fake_classify)
    monkeypatch.setattr("app.services.intent.extract_financial", fake_extract)

    create_one = auth_client.post(
        "/sources",
        json={"name": card_one, "starting_balance": "0", "currency": "IDR", "is_credit_card": True},
    )
    assert create_one.status_code == 201, create_one.text
    create_two = auth_client.post(
        "/sources",
        json={"name": card_two, "starting_balance": "0", "currency": "IDR", "is_credit_card": True},
    )
    assert create_two.status_code == 201, create_two.text

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            _handle_text(db, user, "test-chat", "spent 50k using credit card")

            pending = db.query(AppState).filter_by(key=f"PENDING_SOURCE_CHOICE:{user.id}").one_or_none()
            assert pending is not None
            options = pending.value.get("options") or []
            assert card_one in options and card_two in options

        assert sent, "expected bot prompt"
        assert "multiple credit cards" in sent[-1].lower()
    finally:
        _clear_pending_choice_state(user_id)
        _cleanup_sources(card_one, card_two)


def test_credit_source_disambiguation_accepts_numeric_reply(auth_client, monkeypatch):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    suffix = uuid4().hex[:8]
    card_one = f"pytest_cc_pick_a_{suffix}"
    card_two = f"pytest_cc_pick_b_{suffix}"
    _cleanup_sources(card_one, card_two)

    sent: list[str] = []

    def fake_send_message(chat_id: int | str, text: str, reply_markup: dict | None = None) -> None:
        sent.append(text)

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
                "category": "Food",
                "amount": 77000,
                "source": "credit card",
                "description": "Dinner",
                "date": today_ddmmyyyy,
                "time": None,
            }
        ]

    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)
    monkeypatch.setattr("app.services.intent.classify", fake_classify)
    monkeypatch.setattr("app.services.intent.extract_financial", fake_extract)

    c1 = auth_client.post(
        "/sources",
        json={"name": card_one, "starting_balance": "0", "currency": "IDR", "is_credit_card": True},
    )
    assert c1.status_code == 201, c1.text
    c2 = auth_client.post(
        "/sources",
        json={"name": card_two, "starting_balance": "0", "currency": "IDR", "is_credit_card": True},
    )
    assert c2.status_code == 201, c2.text

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            _handle_text(db, user, "test-chat", "spent 77k using credit card")
            pending = db.query(AppState).filter_by(key=f"PENDING_SOURCE_CHOICE:{user.id}").one_or_none()
            assert pending is not None
            options = pending.value.get("options") or []
            chosen = options[1]

            _handle_text(db, user, "test-chat", "2")

            pending_after = db.query(AppState).filter_by(key=f"PENDING_SOURCE_CHOICE:{user.id}").one_or_none()
            assert pending_after is None

        tx = auth_client.get("/transactions?limit=200").json()["items"]
        hit = next((t for t in tx if t.get("description") == "Dinner" and t.get("source_name") == chosen), None)
        assert hit is not None

        assert any("using source" in m.lower() for m in sent)
    finally:
        _clear_pending_choice_state(user_id)
        _cleanup_sources(card_one, card_two)
