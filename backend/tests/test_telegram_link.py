"""Telegram deep-link account binding (Settings → Connected apps).

Covers the /telegram/link_token + /telegram/unlink endpoints and the
`/start <token>` webhook path. The regression that motivated the feature:
Google-OAuth users have password_hash=None, so `/login <u> <p>` can never
bind them — the token flow must.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.telegram import (
    LINK_EXPIRED_MSG,
    LOGIN_PROMPT,
    _issue_link_token,
    _link_token_key,
    dispatch_update,
)
from app.db.models import AppState, User
from app.services.auth import hash_password


def _make_user(
    db: Session,
    username: str,
    *,
    password: str | None = None,
    status: str = "approved",
    google_sub: str | None = None,
) -> User:
    user = User(
        username=username,
        password_hash=hash_password(password) if password else None,
        status=status,
        google_sub=google_sub,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _delete_user(db: Session, username: str) -> None:
    user = db.query(User).filter_by(username=username).one_or_none()
    if user is not None:
        db.delete(user)
        db.commit()


def _delete_link_rows(db: Session) -> None:
    db.query(AppState).filter(AppState.key.like("TELEGRAM_LINK:%")).delete(
        synchronize_session=False
    )
    row = db.query(AppState).filter_by(key="TELEGRAM_BOT_USERNAME").one_or_none()
    if row is not None:
        db.delete(row)
    db.commit()


def _start_update(chat_id: str, text: str) -> dict:
    return {"update_id": 0, "message": {"chat": {"id": chat_id}, "text": text}}


@pytest.fixture
def sent(monkeypatch) -> list[str]:
    """Capture outbound bot messages; also stubs getMe to a fixed bot name."""
    messages: list[str] = []
    monkeypatch.setattr(
        "app.services.telegram.send_message",
        lambda chat_id, text, reply_markup=None, parse_mode=None: messages.append(text),
    )
    monkeypatch.setattr("app.services.telegram.get_me", lambda: {"username": "TestBot"})
    return messages


# --- link_token endpoint ---------------------------------------------------------


def test_link_token_requires_auth(client: TestClient):
    assert client.post("/telegram/link_token").status_code == 401


def test_link_token_returns_deep_link(auth_client: TestClient, db: Session, sent):
    try:
        r = auth_client.post("/telegram/link_token")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["bot_username"] == "TestBot"
        assert body["expires_in"] == 600
        prefix = "https://t.me/TestBot?start="
        assert body["deep_link"].startswith(prefix)
        token = body["deep_link"][len(prefix):]
        assert 1 <= len(token) <= 64
        assert all(c.isalnum() or c in "_-" for c in token)
        me = auth_client.get("/auth/me").json()
        row = db.query(AppState).filter_by(key=_link_token_key(token)).one_or_none()
        assert row is not None and row.value["user_id"] == int(me["id"])
    finally:
        _delete_link_rows(db)


def test_link_token_replaces_previous_token(auth_client: TestClient, db: Session, sent):
    try:
        first = auth_client.post("/telegram/link_token").json()["deep_link"].split("start=")[1]
        second = auth_client.post("/telegram/link_token").json()["deep_link"].split("start=")[1]
        assert first != second
        assert db.query(AppState).filter_by(key=_link_token_key(first)).one_or_none() is None
        assert db.query(AppState).filter_by(key=_link_token_key(second)).one_or_none() is not None
    finally:
        _delete_link_rows(db)


def test_link_token_503_when_bot_unconfigured(auth_client: TestClient, db: Session, monkeypatch):
    _delete_link_rows(db)  # no cached username
    monkeypatch.setattr("app.services.telegram.get_me", lambda: None)
    assert auth_client.post("/telegram/link_token").status_code == 503


# --- /start <token> webhook binding ----------------------------------------------


def test_start_with_valid_token_binds_unbound_chat(db: Session, sent):
    username = f"link_{uuid4().hex[:8]}"
    user = _make_user(db, username)
    chat = f"pytest-chat-{uuid4().hex[:8]}"
    try:
        token, _ = _issue_link_token(db, user)
        dispatch_update(db, _start_update(chat, f"/start {token}"))
        db.refresh(user)
        assert user.telegram_chat_id == chat
        assert db.query(AppState).filter_by(key=_link_token_key(token)).one_or_none() is None
        assert sent and sent[-1].startswith(f"Connected as {username}.")
    finally:
        _delete_user(db, username)
        _delete_link_rows(db)


def test_start_token_is_single_use(db: Session, sent):
    username = f"link_{uuid4().hex[:8]}"
    user = _make_user(db, username)
    chat = f"pytest-chat-{uuid4().hex[:8]}"
    other = f"pytest-chat-{uuid4().hex[:8]}"
    try:
        token, _ = _issue_link_token(db, user)
        dispatch_update(db, _start_update(chat, f"/start {token}"))
        dispatch_update(db, _start_update(other, f"/start {token}"))
        db.refresh(user)
        assert user.telegram_chat_id == chat  # binding unchanged
        assert sent[-1] == LINK_EXPIRED_MSG
    finally:
        _delete_user(db, username)
        _delete_link_rows(db)


def test_start_with_expired_token_rejected(db: Session, sent):
    username = f"link_{uuid4().hex[:8]}"
    user = _make_user(db, username)
    chat = f"pytest-chat-{uuid4().hex[:8]}"
    token = "expired-" + uuid4().hex[:16]
    try:
        past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        db.add(AppState(key=_link_token_key(token), value={"user_id": user.id, "expires_at": past}))
        db.commit()
        dispatch_update(db, _start_update(chat, f"/start {token}"))
        db.refresh(user)
        assert user.telegram_chat_id is None
        assert sent[-1] == LINK_EXPIRED_MSG
    finally:
        _delete_user(db, username)
        _delete_link_rows(db)


def test_start_with_garbage_payload_rejected(db: Session, sent):
    chat = f"pytest-chat-{uuid4().hex[:8]}"
    dispatch_update(db, _start_update(chat, "/start not!!valid$$payload"))
    assert sent[-1] == LINK_EXPIRED_MSG


def test_start_token_evicts_previous_bindings(db: Session, sent):
    user_a = _make_user(db, f"link_a_{uuid4().hex[:8]}")
    user_b = _make_user(db, f"link_b_{uuid4().hex[:8]}")
    chat = f"pytest-chat-{uuid4().hex[:8]}"
    try:
        user_b.telegram_chat_id = chat  # B currently owns this chat
        user_a.telegram_chat_id = f"pytest-chat-{uuid4().hex[:8]}"  # A bound elsewhere
        db.commit()
        token, _ = _issue_link_token(db, user_a)
        dispatch_update(db, _start_update(chat, f"/start {token}"))
        db.refresh(user_a)
        db.refresh(user_b)
        assert user_a.telegram_chat_id == chat
        assert user_b.telegram_chat_id is None
    finally:
        _delete_user(db, user_a.username)
        _delete_user(db, user_b.username)
        _delete_link_rows(db)


def test_google_user_can_link_end_to_end(db: Session, sent):
    """The motivating regression: no password, so /login can never bind — the
    deep-link token must."""
    username = f"link_g_{uuid4().hex[:8]}"
    user = _make_user(db, username, password=None, google_sub=f"sub-{uuid4().hex[:12]}")
    chat = f"pytest-chat-{uuid4().hex[:8]}"
    try:
        # /login is structurally impossible for this account.
        dispatch_update(db, _start_update(chat, f"/login {username} whatever"))
        assert sent[-1] == "Invalid credentials."

        token, _ = _issue_link_token(db, user)
        dispatch_update(db, _start_update(chat, f"/start {token}"))
        db.refresh(user)
        assert user.telegram_chat_id == chat
        assert sent[-1].startswith(f"Connected as {username}.")
    finally:
        _delete_user(db, username)
        _delete_link_rows(db)


def test_pending_user_token_rejected(db: Session, sent):
    username = f"link_p_{uuid4().hex[:8]}"
    user = _make_user(db, username)
    chat = f"pytest-chat-{uuid4().hex[:8]}"
    try:
        token, _ = _issue_link_token(db, user)
        user.status = "pending"
        db.commit()
        dispatch_update(db, _start_update(chat, f"/start {token}"))
        db.refresh(user)
        assert user.telegram_chat_id is None
        assert sent[-1] == LINK_EXPIRED_MSG
    finally:
        _delete_user(db, username)
        _delete_link_rows(db)


def test_plain_start_unbound_still_prompts_login(db: Session, sent):
    chat = f"pytest-chat-{uuid4().hex[:8]}"
    dispatch_update(db, _start_update(chat, "/start"))
    assert sent[-1] == LOGIN_PROMPT


# --- unlink endpoint --------------------------------------------------------------


def test_unlink_requires_auth(client: TestClient):
    assert client.post("/telegram/unlink").status_code == 401


def test_unlink_clears_chat_id(auth_client: TestClient, db: Session):
    me = auth_client.get("/auth/me").json()
    user = db.query(User).filter_by(id=int(me["id"])).one()
    original = user.telegram_chat_id
    try:
        user.telegram_chat_id = f"pytest-chat-{uuid4().hex[:8]}"
        db.commit()
        assert auth_client.post("/telegram/unlink").status_code == 204
        db.expire_all()
        db.refresh(user)
        assert user.telegram_chat_id is None
    finally:
        user.telegram_chat_id = original
        db.commit()
