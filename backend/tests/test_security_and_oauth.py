"""Regression tests for the auth-bypass fixes and account-status gating."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import User
from app.services.auth import hash_password


def _make_user(
    db: Session,
    username: str,
    *,
    password: str | None = None,
    status: str = "approved",
    is_admin: bool = False,
) -> User:
    user = User(
        username=username,
        password_hash=hash_password(password) if password else None,
        status=status,
        is_admin=is_admin,
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


def test_web_chat_requires_auth(client: TestClient):
    # Previously accepted a body username and ran as that user unauthenticated.
    assert client.post("/telegram/web_chat", json={"text": "spent 5000 on food"}).status_code == 401


def test_set_webhook_requires_auth(client: TestClient):
    assert client.post("/telegram/set_webhook", json={"url": "https://evil.example"}).status_code == 401


def test_set_webhook_forbidden_for_non_admin(client: TestClient, db: Session):
    _make_user(db, "sec_nonadmin", password="pw12345678", status="approved", is_admin=False)
    try:
        assert client.post(
            "/auth/login", json={"username": "sec_nonadmin", "password": "pw12345678"}
        ).status_code == 200
        assert client.post(
            "/telegram/set_webhook", json={"url": "https://evil.example"}
        ).status_code == 403
    finally:
        _delete_user(db, "sec_nonadmin")


def test_pending_user_cannot_login(client: TestClient, db: Session):
    _make_user(db, "sec_pending", password="pw12345678", status="pending")
    try:
        r = client.post("/auth/login", json={"username": "sec_pending", "password": "pw12345678"})
        assert r.status_code == 403
    finally:
        _delete_user(db, "sec_pending")
