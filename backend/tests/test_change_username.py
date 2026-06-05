"""POST /auth/change-username: validation, uniqueness, lowercase normalization,
and that a rename keeps the existing session valid (sessions key on user id)."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import User
from app.services.auth import hash_password


def _make_user(db: Session, username: str, *, password: str = "pw12345678") -> User:
    user = User(username=username, password_hash=hash_password(password), status="approved")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _delete_user_by_id(db: Session, user_id: int) -> None:
    user = db.get(User, user_id)
    if user is not None:
        db.delete(user)  # sessions cascade via ondelete=CASCADE
        db.commit()


def test_change_username_succeeds_and_keeps_session(client: TestClient, db: Session):
    user = _make_user(db, "rename_me")
    try:
        assert client.post(
            "/auth/login", json={"username": "rename_me", "password": "pw12345678"}
        ).status_code == 200

        r = client.post("/auth/change-username", json={"username": "renamed_ok"})
        assert r.status_code == 200, r.text
        assert r.json()["username"] == "renamed_ok"

        # Same session cookie still authenticates as the (now-renamed) user.
        me = client.get("/auth/me")
        assert me.status_code == 200
        assert me.json()["username"] == "renamed_ok"
    finally:
        _delete_user_by_id(db, user.id)


def test_change_username_lowercases_input(client: TestClient, db: Session):
    user = _make_user(db, "case_me")
    try:
        assert client.post(
            "/auth/login", json={"username": "case_me", "password": "pw12345678"}
        ).status_code == 200
        r = client.post("/auth/change-username", json={"username": "  MixedCase.Name  "})
        assert r.status_code == 200, r.text
        assert r.json()["username"] == "mixedcase.name"
    finally:
        _delete_user_by_id(db, user.id)


def test_change_username_rejects_duplicate(client: TestClient, db: Session):
    taken = _make_user(db, "uname_taken")
    mover = _make_user(db, "uname_mover")
    try:
        assert client.post(
            "/auth/login", json={"username": "uname_mover", "password": "pw12345678"}
        ).status_code == 200
        r = client.post("/auth/change-username", json={"username": "uname_taken"})
        assert r.status_code == 409
    finally:
        _delete_user_by_id(db, mover.id)
        _delete_user_by_id(db, taken.id)


def test_change_username_rejects_invalid_format(client: TestClient, db: Session):
    user = _make_user(db, "fmt_me")
    try:
        assert client.post(
            "/auth/login", json={"username": "fmt_me", "password": "pw12345678"}
        ).status_code == 200
        assert client.post("/auth/change-username", json={"username": "ab"}).status_code == 400
        assert client.post(
            "/auth/change-username", json={"username": "bad name!"}
        ).status_code == 400
    finally:
        _delete_user_by_id(db, user.id)


def test_change_username_requires_auth(client: TestClient):
    assert client.post("/auth/change-username", json={"username": "whoever"}).status_code == 401
