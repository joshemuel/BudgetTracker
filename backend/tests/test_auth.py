from fastapi.testclient import TestClient

from app.services.auth import hash_password, verify_password


def test_password_roundtrip():
    h = hash_password("hunter2")
    assert verify_password("hunter2", h)
    assert not verify_password("wrong", h)


def test_me_requires_auth(client: TestClient):
    assert client.get("/auth/me").status_code == 401


def test_login_and_me(client: TestClient):
    r = client.post("/auth/login", json={"username": "josia", "password": "changeme"})
    assert r.status_code == 200
    assert r.json()["username"] == "josia"
    r2 = client.get("/auth/me")
    assert r2.status_code == 200


def test_login_wrong_password(client: TestClient):
    r = client.post("/auth/login", json={"username": "josia", "password": "nope"})
    assert r.status_code == 401
