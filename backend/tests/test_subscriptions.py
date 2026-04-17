from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient

from app.db.models import Subscription
from app.services.subscriptions import _safe_day, advance_next_billing


def test_safe_day_clamps_to_month_length():
    assert _safe_day(2026, 2, 30) == date(2026, 2, 28)
    assert _safe_day(2024, 2, 30) == date(2024, 2, 29)
    assert _safe_day(2026, 4, 31) == date(2026, 4, 30)
    assert _safe_day(2026, 1, 15) == date(2026, 1, 15)


def test_advance_monthly_rolls_year():
    sub = Subscription(
        user_id=0, name="X", amount=0, currency="IDR",
        source_id=0, category_id=0, billing_day=15,
        frequency="monthly", active=True,
        start_date=date(2026, 1, 1),
        next_billing_date=date(2026, 12, 15),
    )
    assert advance_next_billing(sub) == date(2027, 1, 15)


def test_advance_monthly_handles_short_months():
    sub = Subscription(
        user_id=0, name="X", amount=0, currency="IDR",
        source_id=0, category_id=0, billing_day=31,
        frequency="monthly", active=True,
        start_date=date(2026, 1, 1),
        next_billing_date=date(2026, 1, 31),
    )
    assert advance_next_billing(sub) == date(2026, 2, 28)


def test_advance_yearly():
    sub = Subscription(
        user_id=0, name="X", amount=0, currency="IDR",
        source_id=0, category_id=0, billing_day=29,
        frequency="yearly", active=True,
        start_date=date(2024, 2, 29),
        next_billing_date=date(2024, 2, 29),
    )
    # 2025 is not a leap year → clamps to Feb 28
    assert advance_next_billing(sub) == date(2025, 2, 28)


def test_monthly_total_returns_user_default_currency(auth_client: TestClient):
    r = auth_client.get("/subscriptions/monthly-total")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "total" in body and "currency" in body
    # Total should parse as a Decimal.
    Decimal(str(body["total"]))


def test_monthly_total_respects_currency_query(auth_client: TestClient):
    sgd = auth_client.get("/subscriptions/monthly-total?currency=SGD").json()
    assert sgd["currency"] == "SGD"
    idr = auth_client.get("/subscriptions/monthly-total?currency=IDR").json()
    assert idr["currency"] == "IDR"


def test_monthly_total_rejects_unsupported_currency(auth_client: TestClient):
    r = auth_client.get("/subscriptions/monthly-total?currency=USD")
    assert r.status_code == 400


def test_monthly_total_aggregates_yearly_as_twelfth(auth_client: TestClient):
    srcs = auth_client.get("/sources").json()
    cats = auth_client.get("/categories").json()
    assert srcs and cats
    src_id = srcs[0]["id"]
    cat_id = cats[0]["id"]

    baseline = Decimal(
        str(auth_client.get("/subscriptions/monthly-total?currency=IDR").json()["total"])
    )

    created = auth_client.post(
        "/subscriptions",
        json={
            "name": "Test Yearly",
            "amount": "120000",
            "currency": "IDR",
            "source_id": src_id,
            "category_id": cat_id,
            "billing_day": 1,
            "frequency": "yearly",
            "active": True,
            "start_date": "2026-01-01",
        },
    )
    assert created.status_code == 201, created.text
    sub_id = created.json()["id"]

    try:
        after = Decimal(
            str(auth_client.get("/subscriptions/monthly-total?currency=IDR").json()["total"])
        )
        # Yearly 120,000 IDR should contribute 10,000/mo.
        assert abs(after - baseline - Decimal("10000")) < Decimal("1")

        # Deactivate → contribution disappears.
        auth_client.patch(f"/subscriptions/{sub_id}", json={"active": False})
        after_inactive = Decimal(
            str(auth_client.get("/subscriptions/monthly-total?currency=IDR").json()["total"])
        )
        assert abs(after_inactive - baseline) < Decimal("1")
    finally:
        auth_client.delete(f"/subscriptions/{sub_id}")
