"""Auth-bypass fixes (web_chat / set_webhook), account-status gating, admin
approval, and the Google OAuth callback (Google calls mocked)."""

import base64
import json
import time

import pytest
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
    google_sub: str | None = None,
    email: str | None = None,
) -> User:
    user = User(
        username=username,
        password_hash=hash_password(password) if password else None,
        status=status,
        is_admin=is_admin,
        google_sub=google_sub,
        email=email,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _delete_user(db: Session, username: str) -> None:
    user = db.query(User).filter_by(username=username).one_or_none()
    if user is not None:
        db.delete(user)  # sessions cascade via ondelete=CASCADE
        db.commit()


# --- critical auth-bypass fixes -------------------------------------------------


def test_web_chat_requires_auth(client: TestClient):
    # Previously accepted a username in the body and ran as that user, unauthenticated.
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


# --- account-status gating ------------------------------------------------------


def test_pending_user_cannot_login(client: TestClient, db: Session):
    _make_user(db, "sec_pending", password="pw12345678", status="pending")
    try:
        r = client.post("/auth/login", json={"username": "sec_pending", "password": "pw12345678"})
        assert r.status_code == 403
    finally:
        _delete_user(db, "sec_pending")


def test_admin_users_requires_admin(client: TestClient):
    assert client.get("/admin/users").status_code == 401


# --- admin approval flow --------------------------------------------------------


def test_admin_approve_flow(auth_client: TestClient, db: Session):
    _make_user(db, "sec_toapprove", password="pw12345678", status="pending")
    try:
        users = auth_client.get("/admin/users").json()
        match = [u for u in users if u["username"] == "sec_toapprove"]
        assert match and match[0]["status"] == "pending"
        uid = match[0]["id"]

        r = auth_client.post(f"/admin/users/{uid}/approve")
        assert r.status_code == 200 and r.json()["status"] == "approved"

        # Now the account can authenticate.
        fresh = TestClient(auth_client.app)
        assert fresh.post(
            "/auth/login", json={"username": "sec_toapprove", "password": "pw12345678"}
        ).status_code == 200
    finally:
        _delete_user(db, "sec_toapprove")


# --- Google OAuth callback (Google network calls mocked) ------------------------


def test_google_callback_creates_pending_user(client: TestClient, db: Session, monkeypatch):
    class _Settings:
        google_client_id = "test-client"
        session_cookie_secure = False
        frontend_base_url = ""

    monkeypatch.setattr("app.api.auth.get_settings", lambda: _Settings())
    monkeypatch.setattr("app.api.auth.google_oauth.verify_state", lambda value: True)
    monkeypatch.setattr("app.api.auth.google_oauth.exchange_code", lambda code: {"id_token": "fake"})
    monkeypatch.setattr(
        "app.api.auth.google_oauth.decode_id_token",
        lambda token: {
            "sub": "GSUB_TEST_123",
            "email": "gtest_pending@example.com",
            "email_verified": True,
            "name": "G Test",
        },
    )

    client.cookies.set("oauth_state", "abc")
    try:
        r = client.get("/auth/google/callback?code=xyz&state=abc", follow_redirects=False)
        assert r.status_code == 302
        assert r.headers["location"] == "/pending"

        user = db.query(User).filter_by(google_sub="GSUB_TEST_123").one_or_none()
        assert user is not None
        assert user.status == "pending"
        assert user.password_hash is None
    finally:
        user = db.query(User).filter_by(google_sub="GSUB_TEST_123").one_or_none()
        if user is not None:
            db.delete(user)
            db.commit()


def test_google_callback_rejects_bad_state(client: TestClient, monkeypatch):
    class _Settings:
        google_client_id = "test-client"
        session_cookie_secure = False
        frontend_base_url = ""

    monkeypatch.setattr("app.api.auth.get_settings", lambda: _Settings())
    # No oauth_state cookie set → state mismatch → rejected before any Google call.
    r = client.get("/auth/google/callback?code=xyz&state=abc", follow_redirects=False)
    assert r.status_code == 400


# --- ID-token audience-as-set (forward-compat for a native Play Store client) ----


def _fake_id_token(claims: dict) -> str:
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return f"header.{payload}.sig"


def test_decode_id_token_accepts_extra_audience(monkeypatch):
    from app.services import google_oauth

    class _Settings:
        google_client_id = "web-client"
        google_allowed_audiences = "android-client, ios-client"

    monkeypatch.setattr("app.services.google_oauth.get_settings", lambda: _Settings())
    claims = {
        "sub": "S",
        "aud": "android-client",  # not the web client, but explicitly allowed
        "iss": "https://accounts.google.com",
        "exp": int(time.time()) + 600,
    }
    assert google_oauth.decode_id_token(_fake_id_token(claims))["sub"] == "S"


def test_decode_id_token_rejects_unknown_audience(monkeypatch):
    from app.services import google_oauth

    class _Settings:
        google_client_id = "web-client"
        google_allowed_audiences = ""

    monkeypatch.setattr("app.services.google_oauth.get_settings", lambda: _Settings())
    claims = {
        "sub": "S",
        "aud": "some-other-client",
        "iss": "https://accounts.google.com",
        "exp": int(time.time()) + 600,
    }
    with pytest.raises(google_oauth.OAuthError):
        google_oauth.decode_id_token(_fake_id_token(claims))
