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
        db.query(Transaction).filter(Transaction.source_id.in_(ids)).delete(synchronize_session=False)
        for row in rows:
            db.delete(row)
        db.commit()


def test_telegram_log_uses_web_default_expense_source(auth_client, monkeypatch):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    suffix = uuid4().hex[:8]
    src_one = f"pytest_default_src_a_{suffix}"
    src_two = f"pytest_default_src_b_{suffix}"
    _cleanup_sources(src_one, src_two)

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
                "amount": 33000,
                "source": None,
                "description": "Default Source Check",
                "date": today_ddmmyyyy,
                "time": None,
            }
        ]

    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)
    monkeypatch.setattr("app.services.intent.classify", fake_classify)
    monkeypatch.setattr("app.services.intent.extract_financial", fake_extract)

    a = auth_client.post(
        "/sources",
        json={"name": src_one, "starting_balance": "0", "currency": "IDR"},
    )
    assert a.status_code == 201, a.text
    b = auth_client.post(
        "/sources",
        json={"name": src_two, "starting_balance": "0", "currency": "IDR"},
    )
    assert b.status_code == 201, b.text

    try:
        set_pref = auth_client.patch(
            "/auth/me",
            json={"default_expense_source_id": b.json()["id"]},
        )
        assert set_pref.status_code == 200, set_pref.text

        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            _handle_text(db, user, "test-chat", "spent 33k")

        txs = auth_client.get("/transactions?limit=200").json()["items"]
        hit = next((t for t in txs if t.get("description") == "Default Source Check"), None)
        assert hit is not None
        assert hit["source_name"] == src_two
        assert sent
    finally:
        auth_client.patch("/auth/me", json={"default_expense_source_id": None})
        _cleanup_sources(src_one, src_two)


def test_telegram_log_overrides_unmentioned_llm_source_with_default(auth_client, monkeypatch):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    suffix = uuid4().hex[:8]
    src_default = f"pytest_default_src_{suffix}"
    src_wrong = f"pytest_wrong_src_{suffix}"
    _cleanup_sources(src_default, src_wrong)

    def fake_send_message(chat_id: int | str, text: str, reply_markup: dict | None = None) -> None:
        return None

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
                "amount": 22000,
                "source": src_wrong,
                "description": "Default Override Check",
                "date": today_ddmmyyyy,
                "time": None,
            }
        ]

    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)
    monkeypatch.setattr("app.services.intent.classify", fake_classify)
    monkeypatch.setattr("app.services.intent.extract_financial", fake_extract)

    default_src = auth_client.post(
        "/sources",
        json={"name": src_default, "starting_balance": "0", "currency": "IDR"},
    )
    wrong_src = auth_client.post(
        "/sources",
        json={"name": src_wrong, "starting_balance": "0", "currency": "IDR"},
    )
    assert default_src.status_code == 201
    assert wrong_src.status_code == 201

    try:
        auth_client.patch(
            "/auth/me",
            json={"default_expense_source_id": default_src.json()["id"]},
        )
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            _handle_text(db, user, "test-chat", "spent 22k on snack")

        txs = auth_client.get("/transactions?limit=200").json()["items"]
        hit = next((t for t in txs if t.get("description") == "Default Override Check"), None)
        assert hit is not None
        assert hit["source_name"] == src_default
    finally:
        auth_client.patch("/auth/me", json={"default_expense_source_id": None})
        _cleanup_sources(src_default, src_wrong)
