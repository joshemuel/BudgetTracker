"""Coverage for USD currency support (issue 8) and the monthly per-category
breakdown used by the 'By category' chart mode (issue 7)."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from app.services import fx


def test_fx_convert_uses_usd_pivot():
    rates = fx.FxRates(
        rates_per_usd={"USD": Decimal("1"), "IDR": Decimal("16000")},
        fetched_at=datetime.now(timezone.utc),
    )
    assert fx.convert(Decimal("10"), "USD", "IDR", rates) == Decimal("160000.00")
    assert fx.convert(Decimal("16000"), "IDR", "USD", rates) == Decimal("1.00")


def test_usd_source_is_accepted_and_listed(auth_client: TestClient):
    name = f"pytest_usd_{uuid4().hex[:8]}"
    created = auth_client.post(
        "/sources",
        json={"name": name, "starting_balance": "100", "currency": "USD"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["currency"] == "USD"

    currencies = {c["currency"] for c in auth_client.get("/currencies").json()}
    assert "USD" in currencies


def test_monthly_breakdown_returns_category_shape(auth_client: TestClient):
    plain = auth_client.get("/stats/monthly").json()
    assert "categories" not in plain  # breakdown is opt-in
    assert all("categories" not in m for m in plain["months"])

    broken_down = auth_client.get("/stats/monthly?breakdown=category").json()
    assert "categories" in broken_down
    assert isinstance(broken_down["categories"], list)
    assert len(broken_down["months"]) == 12
    assert all("categories" in m and isinstance(m["categories"], list) for m in broken_down["months"])
