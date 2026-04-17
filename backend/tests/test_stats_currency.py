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
