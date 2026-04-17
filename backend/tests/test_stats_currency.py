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


def test_overview_converts_budget_from_its_own_currency(auth_client: TestClient):
    cats = auth_client.get("/categories").json()
    assert cats, "seed data should include categories"
    cat_id = cats[0]["id"]

    # Start clean: remove any existing budget on this category.
    for b in auth_client.get("/budgets").json():
        if b["category_id"] == cat_id:
            auth_client.delete(f"/budgets/{b['id']}")

    # Create a budget in SGD with limit 100.
    created = auth_client.post(
        "/budgets",
        json={"category_id": cat_id, "monthly_limit": "100", "currency": "SGD"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["currency"] == "SGD"
    budget_id = created.json()["id"]

    try:
        # View overview in SGD — the 100 SGD limit should come back ≈100 (no FX change).
        ov = auth_client.get("/stats/overview?currency=SGD").json()
        row = next(b for b in ov["budgets"] if b["category_id"] == cat_id)
        assert abs(_to_decimal(row["limit"]) - Decimal("100")) < Decimal("0.02")

        # View in IDR — should be much bigger (SGD→IDR FX).
        ov_idr = auth_client.get("/stats/overview?currency=IDR").json()
        row_idr = next(b for b in ov_idr["budgets"] if b["category_id"] == cat_id)
        assert _to_decimal(row_idr["limit"]) > Decimal("1000")
    finally:
        auth_client.delete(f"/budgets/{budget_id}")
