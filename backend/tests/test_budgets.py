from fastapi.testclient import TestClient


def _cleanup_budget(auth_client: TestClient, category_id: int) -> None:
    for b in auth_client.get("/budgets").json():
        if b["category_id"] == category_id:
            auth_client.delete(f"/budgets/{b['id']}")


def test_create_budget_defaults_to_user_default_currency(auth_client: TestClient):
    me = auth_client.get("/auth/me").json()
    original = me.get("default_currency", "IDR")
    cats = auth_client.get("/categories").json()
    cat_id = cats[0]["id"]

    try:
        auth_client.patch("/auth/me", json={"default_currency": "AUD"})
        _cleanup_budget(auth_client, cat_id)
        r = auth_client.post(
            "/budgets", json={"category_id": cat_id, "monthly_limit": "50"}
        )
        assert r.status_code == 201, r.text
        assert r.json()["currency"] == "AUD"
        auth_client.delete(f"/budgets/{r.json()['id']}")
    finally:
        auth_client.patch("/auth/me", json={"default_currency": original})


def test_update_budget_currency(auth_client: TestClient):
    cats = auth_client.get("/categories").json()
    cat_id = cats[0]["id"]
    _cleanup_budget(auth_client, cat_id)

    created = auth_client.post(
        "/budgets",
        json={"category_id": cat_id, "monthly_limit": "100", "currency": "IDR"},
    )
    assert created.status_code == 201
    bid = created.json()["id"]

    try:
        patched = auth_client.patch(
            f"/budgets/{bid}",
            json={"monthly_limit": "42", "currency": "TWD"},
        )
        assert patched.status_code == 200, patched.text
        body = patched.json()
        assert body["currency"] == "TWD"
        assert body["monthly_limit"] in ("42", "42.0", "42.00")
    finally:
        auth_client.delete(f"/budgets/{bid}")


def test_create_budget_rejects_unsupported_currency(auth_client: TestClient):
    cats = auth_client.get("/categories").json()
    cat_id = cats[0]["id"]
    _cleanup_budget(auth_client, cat_id)

    r = auth_client.post(
        "/budgets",
        json={"category_id": cat_id, "monthly_limit": "100", "currency": "USD"},
    )
    assert r.status_code == 422
