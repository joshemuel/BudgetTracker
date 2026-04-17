from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def auth_client(client: TestClient) -> TestClient:
    """A TestClient logged in as the seed user 'josia'."""
    resp = client.post("/auth/login", json={"username": "josia", "password": "changeme"})
    assert resp.status_code == 200, resp.text
    return client
