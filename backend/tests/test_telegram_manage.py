"""Telegram natural-language management flow (issue 2): a 'manage' intent
previews the change with a Confirm/Cancel keyboard and only applies it on the
confirm callback; 'unsupported' intents tell the user what the bot can't do."""

from uuid import uuid4

from app.api.telegram import CAPABILITIES_MSG, _handle_manage_callback, _handle_text
from app.db.models import AppState, Category, User
from app.db.session import SessionLocal


def _cleanup_category(name: str, user_id: int) -> None:
    with SessionLocal() as db:
        row = db.query(Category).filter_by(user_id=user_id, name=name).one_or_none()
        if row is not None:
            db.delete(row)
        state = db.query(AppState).filter_by(key=f"PENDING_MANAGE:{user_id}").one_or_none()
        if state is not None:
            db.delete(state)
        db.commit()


def test_manage_create_category_requires_confirmation_then_applies(auth_client, monkeypatch):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    name = f"pytest_cat_{uuid4().hex[:8]}"

    sent: list[tuple[str, dict | None]] = []

    def fake_send_message(chat_id, text, reply_markup=None):
        sent.append((text, reply_markup))

    monkeypatch.setattr("app.services.telegram.send_message", fake_send_message)
    monkeypatch.setattr("app.services.telegram.answer_callback_query", lambda *a, **k: True)
    monkeypatch.setattr("app.services.telegram.edit_message_text", lambda *a, **k: True)
    monkeypatch.setattr(
        "app.services.intent.classify",
        lambda text, cats, srcs: {
            "type": "manage",
            "entity": "category",
            "action": "create",
            "name": name,
            "new_name": None,
        },
    )

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            _handle_text(db, user, "chat-1", f"add a category called {name}")

            # Nothing created yet — only a preview + confirmation keyboard.
            assert db.query(Category).filter_by(user_id=user_id, name=name).one_or_none() is None
            assert sent and sent[-1][1] is not None, "expected a confirm/cancel keyboard"
            buttons = sent[-1][1]["inline_keyboard"][0]
            assert any(b["callback_data"] == "mng:confirm" for b in buttons)

            pending = db.query(AppState).filter_by(key=f"PENDING_MANAGE:{user_id}").one_or_none()
            assert pending is not None and pending.value["action"] == "create"

            # Confirm → the category is actually created and state cleared.
            cb = {
                "id": "cbid",
                "data": "mng:confirm",
                "message": {"chat": {"id": "chat-1"}, "message_id": 99},
            }
            _handle_manage_callback(db, user, cb)

            assert db.query(Category).filter_by(user_id=user_id, name=name).one_or_none() is not None
            assert db.query(AppState).filter_by(key=f"PENDING_MANAGE:{user_id}").one_or_none() is None
    finally:
        _cleanup_category(name, user_id)


def test_unsupported_intent_reports_capabilities(auth_client, monkeypatch):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    sent: list[str] = []
    monkeypatch.setattr(
        "app.services.telegram.send_message",
        lambda chat_id, text, reply_markup=None: sent.append(text),
    )
    monkeypatch.setattr("app.services.intent.classify", lambda text, cats, srcs: {"type": "unsupported"})

    with SessionLocal() as db:
        user = db.query(User).filter_by(id=user_id).one()
        _handle_text(db, user, "chat-2", "export everything to excel and email it")

    assert sent and sent[-1] == CAPABILITIES_MSG
