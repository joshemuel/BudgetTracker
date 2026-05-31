from uuid import uuid4

from app.api.telegram import _handle_text, _handle_tx_callback
from app.db.models import AppState, Budget, Category, Source, Transaction, User
from app.db.session import SessionLocal
from app.services.parse import tz


def test_telegram_edit_marks_original_message_and_restores_updated_entry(
    auth_client,
    monkeypatch,
):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    suffix = uuid4().hex[:8]
    category_name = f"pytest_edit_cat_{suffix}"
    source_name = f"pytest_edit_src_{suffix}"

    created_cat = auth_client.post("/categories", json={"name": category_name})
    assert created_cat.status_code == 201, created_cat.text
    category = created_cat.json()
    created_source = auth_client.post(
        "/sources",
        json={"name": source_name, "starting_balance": "0", "currency": "IDR"},
    )
    assert created_source.status_code == 201, created_source.text
    source = created_source.json()
    created_tx = auth_client.post(
        "/transactions",
        json={
            "occurred_at": "2026-04-20T12:00:00+07:00",
            "type": "expense",
            "category_id": category["id"],
            "amount": "50",
            "source_id": source["id"],
            "description": "Telegram edit regression",
        },
    )
    assert created_tx.status_code == 201, created_tx.text
    tx_id = int(created_tx.json()["id"])

    answers: list[str] = []
    sent: list[str] = []
    edits: list[dict] = []

    def fake_answer_callback_query(callback_query_id: str, text: str | None = None) -> bool:
        answers.append(text or "")
        return True

    def fake_send_message(chat_id: int | str, text: str, reply_markup: dict | None = None) -> bool:
        sent.append(text)
        return True

    def fake_edit_message_text(
        chat_id: int | str,
        message_id: int,
        text: str,
        reply_markup: dict | None = None,
    ) -> bool:
        edits.append(
            {
                "chat_id": chat_id,
                "message_id": message_id,
                "text": text,
                "reply_markup": reply_markup,
            }
        )
        return True

    monkeypatch.setattr("app.services.telegram.answer_callback_query", fake_answer_callback_query)
    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)
    monkeypatch.setattr("app.services.telegram.edit_message_text", fake_edit_message_text)

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            cb = {
                "id": "callback-1",
                "data": f"tx:edit:{tx_id}",
                "message": {
                    "chat": {"id": "test-chat"},
                    "message_id": 777,
                    "text": "Logged\n\nAmount: Rp 50",
                    "reply_markup": {
                        "inline_keyboard": [
                            [
                                {"text": "Edit", "callback_data": f"tx:edit:{tx_id}"},
                                {"text": "Delete", "callback_data": f"tx:delete:{tx_id}"},
                            ]
                        ]
                    },
                },
            }
            _handle_tx_callback(db, user, cb)

            assert answers[-1] == "Tell me what to change."
            assert edits[-1]["text"].startswith("Editing")
            assert any("What do you want to change?" in m for m in sent)

            _handle_text(db, user, "test-chat", "amount 75")

            db.expire_all()
            updated = db.get(Transaction, tx_id)
            assert updated is not None
            assert str(updated.amount) == "75.00"

        assert any("Updated amount from 50 to 75" in m for m in sent)
        assert "Amount: Rp 75" in edits[-1]["text"]
        assert edits[-1]["reply_markup"] is not None
    finally:
        with SessionLocal() as db:
            db.query(AppState).filter(AppState.key == f"PENDING_TX_EDIT:{user_id}").delete(
                synchronize_session=False
            )
            db.query(Transaction).filter(Transaction.id == tx_id).delete(synchronize_session=False)
            db.query(Budget).filter(Budget.category_id == category["id"]).delete(
                synchronize_session=False
            )
            db.query(Source).filter(Source.id == source["id"]).delete(synchronize_session=False)
            db.query(Category).filter(Category.id == category["id"]).delete(synchronize_session=False)
            db.commit()


def test_telegram_edit_can_change_entry_date(auth_client, monkeypatch):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    suffix = uuid4().hex[:8]
    category_name = f"pytest_editdate_cat_{suffix}"
    source_name = f"pytest_editdate_src_{suffix}"
    category = auth_client.post("/categories", json={"name": category_name}).json()
    source = auth_client.post(
        "/sources",
        json={"name": source_name, "starting_balance": "0", "currency": "IDR"},
    ).json()
    created_tx = auth_client.post(
        "/transactions",
        json={
            "occurred_at": "2026-04-20T12:00:00+07:00",
            "type": "expense",
            "category_id": category["id"],
            "amount": "50",
            "source_id": source["id"],
            "description": "date edit regression",
        },
    )
    assert created_tx.status_code == 201, created_tx.text
    tx_id = int(created_tx.json()["id"])

    sent: list[str] = []
    monkeypatch.setattr("app.services.telegram.answer_callback_query", lambda *a, **k: True)
    monkeypatch.setattr(
        "app.services.telegram.send_message",
        lambda chat_id, text, reply_markup=None: (sent.append(text), True)[1],
    )
    monkeypatch.setattr("app.services.telegram.edit_message_text", lambda *a, **k: True)

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            cb = {
                "id": "callback-date",
                "data": f"tx:edit:{tx_id}",
                "message": {
                    "chat": {"id": "test-chat"},
                    "message_id": 778,
                    "text": "Logged\n\nAmount: Rp 50",
                    "reply_markup": {
                        "inline_keyboard": [
                            [{"text": "Edit", "callback_data": f"tx:edit:{tx_id}"}]
                        ]
                    },
                },
            }
            _handle_tx_callback(db, user, cb)
            _handle_text(db, user, "test-chat", "date 12/25/2025")

            db.expire_all()
            updated = db.get(Transaction, tx_id)
            assert updated is not None
            local = updated.occurred_at.astimezone(tz())
            assert (local.year, local.month, local.day) == (2025, 12, 25)
            assert local.hour == 12  # original time-of-day preserved

        assert any("Updated date from 04/20/2026 to 12/25/2025" in m for m in sent)
    finally:
        with SessionLocal() as db:
            db.query(AppState).filter(AppState.key == f"PENDING_TX_EDIT:{user_id}").delete(
                synchronize_session=False
            )
            db.query(Transaction).filter(Transaction.id == tx_id).delete(synchronize_session=False)
            db.query(Source).filter(Source.id == source["id"]).delete(synchronize_session=False)
            db.query(Category).filter(Category.id == category["id"]).delete(
                synchronize_session=False
            )
            db.commit()
