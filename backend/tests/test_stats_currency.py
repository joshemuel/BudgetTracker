from decimal import Decimal

from fastapi.testclient import TestClient


def _to_decimal(value: str) -> Decimal:
    return Decimal(str(value))


def test_overview_uses_default_currency_from_user_preference(auth_client: TestClient):
    r0 = auth_client.get("/auth/me")
    assert r0.status_code == 200
    original_currency = r0.json().get("default_currency", "IDR")

    try:
        r = auth_client.patch("/auth/me", json={"default_currency": "SGD"})
        assert r.status_code == 200, r.text

        ov = auth_client.get("/stats/overview")
        assert ov.status_code == 200, ov.text
        body = ov.json()
        assert body["currency"] == "SGD"

        totals = body["totals"]
        _to_decimal(totals["income"])
        _to_decimal(totals["expense"])
        _to_decimal(totals["net"])
    finally:
        auth_client.patch("/auth/me", json={"default_currency": original_currency})


def test_monthly_and_daily_accept_currency_override(auth_client: TestClient):
    m = auth_client.get("/stats/monthly?year=2026&currency=TWD")
    assert m.status_code == 200, m.text
    m_body = m.json()
    assert m_body["currency"] == "TWD"
    assert len(m_body["months"]) == 12

    d = auth_client.get("/stats/daily?year=2026&month=4&currency=SGD")
    assert d.status_code == 200, d.text
    d_body = d.json()
    assert d_body["currency"] == "SGD"
    assert len(d_body["days"]) >= 28


def test_stats_reject_unsupported_currency(auth_client: TestClient):
    r = auth_client.get("/stats/overview?currency=USD")
    assert r.status_code == 400


def test_categories_stats_returns_requested_currency(auth_client: TestClient):
    r = auth_client.get("/stats/categories?currency=SGD")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["currency"] == "SGD"
    assert "categories" in body


def test_categories_stats_defaults_to_user_currency(auth_client: TestClient):
    r0 = auth_client.get("/auth/me")
    original = r0.json().get("default_currency", "IDR")
    try:
        auth_client.patch("/auth/me", json={"default_currency": "JPY"})
        r = auth_client.get("/stats/categories")
        assert r.status_code == 200, r.text
        assert r.json()["currency"] == "JPY"
    finally:
        auth_client.patch("/auth/me", json={"default_currency": original})


def test_overview_converts_budget_from_default_currency(auth_client: TestClient):
    me = auth_client.get("/auth/me").json()
    original_currency = me.get("default_currency", "IDR")
    created_cat = auth_client.post(
        "/categories",
        json={"name": "pytest_stats_budget_cat"},
    )
    assert created_cat.status_code in (201, 409), created_cat.text
    cats = auth_client.get("/categories").json()
    cat_id = next(c["id"] for c in cats if c["name"] == "pytest_stats_budget_cat")

    try:
        auth_client.patch("/auth/me", json={"default_currency": "IDR"})

        for b in auth_client.get("/budgets").json():
            if b["category_id"] == cat_id:
                auth_client.delete(f"/budgets/{b['id']}")

        created = auth_client.post(
            "/budgets",
            json={"category_id": cat_id, "monthly_limit": "100"},
        )
        assert created.status_code == 201, created.text
        assert created.json()["currency"] == "IDR"
        budget_id = created.json()["id"]

        ov_idr = auth_client.get("/stats/overview?currency=IDR").json()
        row_idr = next(b for b in ov_idr["budgets"] if b["category_id"] == cat_id)
        assert abs(_to_decimal(row_idr["limit"]) - Decimal("100")) < Decimal("0.02")

        ov_sgd = auth_client.get("/stats/overview?currency=SGD").json()
        row_sgd = next(b for b in ov_sgd["budgets"] if b["category_id"] == cat_id)
        assert _to_decimal(row_sgd["limit"]) > Decimal("0")
        assert _to_decimal(row_sgd["limit"]) < Decimal("100")
    finally:
        for b in auth_client.get("/budgets").json():
            if b["category_id"] == cat_id:
                auth_client.delete(f"/budgets/{b['id']}")
        auth_client.delete(f"/categories/{cat_id}")
        auth_client.patch("/auth/me", json={"default_currency": original_currency})


def test_default_currency_change_propagates_existing_budget_currency(auth_client: TestClient):
    me = auth_client.get("/auth/me").json()
    original_currency = me.get("default_currency", "IDR")
    created_cat = auth_client.post(
        "/categories",
        json={"name": "pytest_stats_budget_currency_cat"},
    )
    assert created_cat.status_code in (201, 409), created_cat.text
    cats = auth_client.get("/categories").json()
    cat_id = next(c["id"] for c in cats if c["name"] == "pytest_stats_budget_currency_cat")

    try:
        for b in auth_client.get("/budgets").json():
            if b["category_id"] == cat_id:
                auth_client.delete(f"/budgets/{b['id']}")

        auth_client.patch("/auth/me", json={"default_currency": "IDR"})
        created = auth_client.post(
            "/budgets",
            json={"category_id": cat_id, "monthly_limit": "150000"},
        )
        assert created.status_code == 201, created.text
        bid = created.json()["id"]
        assert created.json()["currency"] == "IDR"

        changed = auth_client.patch("/auth/me", json={"default_currency": "SGD"})
        assert changed.status_code == 200, changed.text

        budgets = auth_client.get("/budgets").json()
        target = next(b for b in budgets if b["id"] == bid)
        assert target["currency"] == "SGD"
        assert _to_decimal(target["monthly_limit"]) > Decimal("0")
        assert _to_decimal(target["monthly_limit"]) < Decimal("150000")
    finally:
        for b in auth_client.get("/budgets").json():
            if b["category_id"] == cat_id:
                auth_client.delete(f"/budgets/{b['id']}")
        auth_client.delete(f"/categories/{cat_id}")
        auth_client.patch("/auth/me", json={"default_currency": original_currency})


def test_sync_token_advances_after_new_transaction(auth_client: TestClient):
    before = auth_client.get("/stats/sync")
    assert before.status_code == 200, before.text
    token_before = int(before.json().get("token", 0))

    categories = auth_client.get("/categories").json()
    sources = auth_client.get("/sources").json()
    assert categories and sources

    created = auth_client.post(
        "/transactions",
        json={
            "occurred_at": "2026-04-18T10:00:00Z",
            "type": "expense",
            "category_id": categories[0]["id"],
            "amount": "12345",
            "source_id": sources[0]["id"],
            "description": "sync-token-test",
        },
    )
    assert created.status_code == 201, created.text
    tx_id = created.json()["id"]

    try:
        after = auth_client.get("/stats/sync")
        assert after.status_code == 200, after.text
        token_after = int(after.json().get("token", 0))
        assert token_after >= tx_id
        assert token_after > token_before
    finally:
        auth_client.delete(f"/transactions/{tx_id}")
