from uuid import uuid4

from fastapi.testclient import TestClient

from app.db.models import Category
from app.db.session import SessionLocal


def test_delete_default_category_is_allowed_when_not_in_use(auth_client: TestClient):
    name = f"PyDefault{uuid4().hex[:8]}"
    created = auth_client.post("/categories", json={"name": name})
    assert created.status_code == 201, created.text
    cat = created.json()

    with SessionLocal() as db:
        row = db.query(Category).filter_by(id=cat["id"]).one()
        row.is_default = True
        db.commit()

    deleted = auth_client.delete(f"/categories/{cat['id']}")
    assert deleted.status_code == 204, deleted.text

    listed = auth_client.get("/categories").json()
    assert all(c["id"] != cat["id"] for c in listed)
