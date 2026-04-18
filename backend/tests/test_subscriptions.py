from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db.models import AppState, Source, Subscription, SubscriptionCharge, Transaction
from app.services import fx
from app.services.subscriptions import _safe_day, advance_next_billing


def test_safe_day_clamps_to_month_length():
    assert _safe_day(2026, 2, 30) == date(2026, 2, 28)
    assert _safe_day(2024, 2, 30) == date(2024, 2, 29)
    assert _safe_day(2026, 4, 31) == date(2026, 4, 30)
    assert _safe_day(2026, 1, 15) == date(2026, 1, 15)


def test_advance_monthly_rolls_year():
    sub = Subscription(
        user_id=0,
        name="X",
        amount=0,
        currency="IDR",
        source_id=0,
        category_id=0,
        billing_day=15,
        frequency="monthly",
        active=True,
        start_date=date(2026, 1, 1),
        next_billing_date=date(2026, 12, 15),
    )
    assert advance_next_billing(sub) == date(2027, 1, 15)


def test_advance_monthly_handles_short_months():
    sub = Subscription(
        user_id=0,
        name="X",
        amount=0,
        currency="IDR",
        source_id=0,
        category_id=0,
        billing_day=31,
        frequency="monthly",
        active=True,
        start_date=date(2026, 1, 1),
        next_billing_date=date(2026, 1, 31),
    )
    assert advance_next_billing(sub) == date(2026, 2, 28)


def test_advance_yearly():
    sub = Subscription(
        user_id=0,
        name="X",
        amount=0,
        currency="IDR",
        source_id=0,
        category_id=0,
        billing_day=29,
        frequency="yearly",
        active=True,
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


def test_create_subscription_defaults_to_source_currency(auth_client: TestClient):
    src_name = f"pytest_sub_src_{uuid4().hex[:8]}"
    src = auth_client.post(
        "/sources",
        json={
            "name": src_name,
            "starting_balance": "100.00",
            "currency": "SGD",
        },
    )
    assert src.status_code == 201, src.text
    source_id = src.json()["id"]

    categories = auth_client.get("/categories").json()
    category_id = categories[0]["id"]

    created = auth_client.post(
        "/subscriptions",
        json={
            "name": "Source-default-currency",
            "amount": "12.50",
            "source_id": source_id,
            "category_id": category_id,
            "billing_day": 1,
            "frequency": "monthly",
            "active": True,
            "start_date": "2026-01-01",
        },
    )
    assert created.status_code == 201, created.text
    sub_id = created.json()["id"]
    assert created.json()["currency"] == "SGD"

    auth_client.delete(f"/subscriptions/{sub_id}")
    auth_client.delete(f"/sources/{source_id}")


def test_confirm_charge_converts_subscription_currency_to_source_currency(
    auth_client: TestClient,
    db,
):
    existing_state = db.get(AppState, fx.STATE_KEY)
    backup_value = deepcopy(existing_state.value) if existing_state is not None else None

    fixed_rates = {
        "USD": "1",
        "IDR": "10000",
        "SGD": "1",
        "JPY": "150",
        "AUD": "1.5",
        "TWD": "32",
    }
    payload = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "rates": fixed_rates,
    }
    if existing_state is None:
        db.add(AppState(key=fx.STATE_KEY, value=payload))
    else:
        existing_state.value = payload
    db.commit()

    src_name = f"pytest_sub_fx_src_{uuid4().hex[:8]}"
    src = auth_client.post(
        "/sources",
        json={
            "name": src_name,
            "starting_balance": "0",
            "currency": "SGD",
        },
    )
    assert src.status_code == 201, src.text
    source_id = src.json()["id"]

    categories = auth_client.get("/categories").json()
    category_id = categories[0]["id"]

    today = date.today()
    created = auth_client.post(
        "/subscriptions",
        json={
            "name": "FX-charge",
            "amount": "12000",
            "currency": "IDR",
            "source_id": source_id,
            "category_id": category_id,
            "billing_day": today.day,
            "frequency": "monthly",
            "active": True,
            "start_date": today.isoformat(),
            "next_billing_date": today.isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    sub_id = created.json()["id"]

    tx_id: int | None = None
    try:
        trigger = auth_client.post("/subscriptions/_run_daily")
        assert trigger.status_code == 200, trigger.text

        pending = auth_client.get("/subscriptions/charges/pending")
        assert pending.status_code == 200, pending.text
        charge = next(c for c in pending.json() if c["subscription_id"] == sub_id)

        confirmed = auth_client.post(f"/subscriptions/charges/{charge['id']}/confirm")
        assert confirmed.status_code == 200, confirmed.text
        tx_id = confirmed.json()["transaction_id"]

        tx = db.query(Transaction).filter_by(id=tx_id).one()
        assert tx.source_id == source_id
        assert Decimal(str(tx.amount)) == Decimal("1.20")
    finally:
        if tx_id is not None:
            db.query(SubscriptionCharge).filter(
                SubscriptionCharge.subscription_id == sub_id
            ).update({SubscriptionCharge.transaction_id: None}, synchronize_session=False)
            db.query(Transaction).filter(Transaction.id == tx_id).update(
                {Transaction.subscription_charge_id: None}, synchronize_session=False
            )
            db.flush()
            db.query(Transaction).filter(Transaction.id == tx_id).delete(synchronize_session=False)
        db.query(SubscriptionCharge).filter(SubscriptionCharge.subscription_id == sub_id).delete(
            synchronize_session=False
        )
        db.query(Subscription).filter(Subscription.id == sub_id).delete(synchronize_session=False)
        db.query(Source).filter(Source.id == source_id).delete(synchronize_session=False)
        if backup_value is None:
            db.query(AppState).filter(AppState.key == fx.STATE_KEY).delete(
                synchronize_session=False
            )
        else:
            restored = db.get(AppState, fx.STATE_KEY)
            if restored is None:
                db.add(AppState(key=fx.STATE_KEY, value=backup_value))
            else:
                restored.value = backup_value
        db.commit()
