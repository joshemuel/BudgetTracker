from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db.models import AppState
from app.services import fx


def _to_decimal(v: str | int | float) -> Decimal:
    return Decimal(str(v))


def _create_tx(
    auth_client: TestClient,
    *,
    occurred_at: datetime,
    tx_type: str,
    category_id: int,
    amount: str,
    source_id: int,
    description: str,
) -> int:
    r = auth_client.post(
        "/transactions",
        json={
            "occurred_at": occurred_at.isoformat(),
            "type": tx_type,
            "category_id": category_id,
            "amount": amount,
            "source_id": source_id,
            "description": description,
        },
    )
    assert r.status_code == 201, r.text
    return int(r.json()["id"])


def _seed_fx_rates(db) -> None:
    payload = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "rates": {
            "USD": "1",
            "IDR": "16000",
            "SGD": "1.35",
            "JPY": "150",
            "AUD": "1.5",
            "TWD": "32",
        },
    }
    state = db.get(AppState, fx.STATE_KEY)
    if state is None:
        db.add(AppState(key=fx.STATE_KEY, value=payload))
    else:
        state.value = payload
    db.commit()


def test_stats_exclude_untrackable_from_overview_monthly_daily_and_categories(
    auth_client: TestClient,
    db,
):
    _seed_fx_rates(db)
    categories = auth_client.get("/categories").json()
    sources = auth_client.get("/sources").json()
    assert categories and sources

    untracked = next(
        c
        for c in categories
        if str(c["name"]).strip().lower() in {"untrackable", "untracked"}
    )
    tracked = next(
        c
        for c in categories
        if str(c["name"]).strip().lower() not in {"untrackable", "untracked"}
    )
    source_id = int(sources[0]["id"])

    occurred = datetime.now(timezone.utc).replace(day=15, hour=10, minute=0, second=0, microsecond=0)
    year = occurred.year
    month = occurred.month
    day = occurred.day
    from_to = occurred.date().isoformat()

    before_overview = auth_client.get(
        f"/stats/overview?year={year}&month={month}&currency=IDR"
    ).json()
    before_monthly = auth_client.get(f"/stats/monthly?year={year}&currency=IDR").json()
    before_daily = auth_client.get(f"/stats/daily?year={year}&month={month}&currency=IDR").json()
    before_categories = auth_client.get(
        f"/stats/categories?from={from_to}&to={from_to}&currency=IDR"
    ).json()

    tx_ids: list[int] = []
    try:
        tx_ids.append(
            _create_tx(
                auth_client,
                occurred_at=occurred,
                tx_type="expense",
                category_id=int(tracked["id"]),
                amount="111",
                source_id=source_id,
                description=f"pytest-tracked-expense-{uuid4().hex[:8]}",
            )
        )
        tx_ids.append(
            _create_tx(
                auth_client,
                occurred_at=occurred,
                tx_type="expense",
                category_id=int(untracked["id"]),
                amount="222",
                source_id=source_id,
                description=f"pytest-untracked-expense-{uuid4().hex[:8]}",
            )
        )
        tx_ids.append(
            _create_tx(
                auth_client,
                occurred_at=occurred,
                tx_type="income",
                category_id=int(tracked["id"]),
                amount="51",
                source_id=source_id,
                description=f"pytest-tracked-income-{uuid4().hex[:8]}",
            )
        )
        tx_ids.append(
            _create_tx(
                auth_client,
                occurred_at=occurred,
                tx_type="income",
                category_id=int(untracked["id"]),
                amount="333",
                source_id=source_id,
                description=f"pytest-untracked-income-{uuid4().hex[:8]}",
            )
        )

        after_overview = auth_client.get(
            f"/stats/overview?year={year}&month={month}&currency=IDR"
        ).json()
        after_monthly = auth_client.get(f"/stats/monthly?year={year}&currency=IDR").json()
        after_daily = auth_client.get(f"/stats/daily?year={year}&month={month}&currency=IDR").json()
        after_categories = auth_client.get(
            f"/stats/categories?from={from_to}&to={from_to}&currency=IDR"
        ).json()

        before_ov_totals = before_overview["totals"]
        after_ov_totals = after_overview["totals"]
        assert (
            _to_decimal(after_ov_totals["expense"]) - _to_decimal(before_ov_totals["expense"])
            == Decimal("111")
        )
        assert (
            _to_decimal(after_ov_totals["income"]) - _to_decimal(before_ov_totals["income"])
            == Decimal("51")
        )

        before_month_row = next(m for m in before_monthly["months"] if int(m["month"]) == month)
        after_month_row = next(m for m in after_monthly["months"] if int(m["month"]) == month)
        assert (
            _to_decimal(after_month_row["expense"]) - _to_decimal(before_month_row["expense"])
            == Decimal("111")
        )
        assert (
            _to_decimal(after_month_row["income"]) - _to_decimal(before_month_row["income"])
            == Decimal("51")
        )

        before_day_row = next(d for d in before_daily["days"] if int(d["day"]) == day)
        after_day_row = next(d for d in after_daily["days"] if int(d["day"]) == day)
        assert (
            _to_decimal(after_day_row["expense"]) - _to_decimal(before_day_row["expense"])
            == Decimal("111")
        )
        assert (
            _to_decimal(after_day_row["income"]) - _to_decimal(before_day_row["income"])
            == Decimal("51")
        )

        before_cat = {
            int(c["category_id"]): c for c in before_categories.get("categories", [])
        }
        after_cat = {int(c["category_id"]): c for c in after_categories.get("categories", [])}
        before_tracked = before_cat.get(int(tracked["id"]))
        after_tracked = after_cat.get(int(tracked["id"]))
        assert after_tracked is not None
        tracked_expense_before = (
            _to_decimal(before_tracked["expense"]) if before_tracked is not None else Decimal("0")
        )
        tracked_income_before = (
            _to_decimal(before_tracked["income"]) if before_tracked is not None else Decimal("0")
        )
        assert _to_decimal(after_tracked["expense"]) - tracked_expense_before == Decimal("111")
        assert _to_decimal(after_tracked["income"]) - tracked_income_before == Decimal("51")

        before_untracked = before_cat.get(int(untracked["id"]))
        after_untracked = after_cat.get(int(untracked["id"]))
        if before_untracked is None:
            assert after_untracked is None
        else:
            assert after_untracked is not None
            assert _to_decimal(after_untracked["expense"]) == _to_decimal(before_untracked["expense"])
            assert _to_decimal(after_untracked["income"]) == _to_decimal(before_untracked["income"])
    finally:
        for tx_id in tx_ids:
            auth_client.delete(f"/transactions/{tx_id}")


def test_overview_credit_summary_excludes_untrackable(auth_client: TestClient, db):
    _seed_fx_rates(db)
    categories = auth_client.get("/categories").json()
    assert categories
    untracked = next(
        c
        for c in categories
        if str(c["name"]).strip().lower() in {"untrackable", "untracked"}
    )
    tracked = next(
        c
        for c in categories
        if str(c["name"]).strip().lower() not in {"untrackable", "untracked"}
    )

    source_name = f"pytest_cc_src_{uuid4().hex[:8]}"
    created_source = auth_client.post(
        "/sources",
        json={
            "name": source_name,
            "starting_balance": "0",
            "currency": "IDR",
            "is_credit_card": True,
        },
    )
    assert created_source.status_code == 201, created_source.text
    source_id = int(created_source.json()["id"])

    occurred = datetime.now(timezone.utc).replace(day=15, hour=11, minute=0, second=0, microsecond=0)
    year = occurred.year
    month = occurred.month

    before = auth_client.get(f"/stats/overview?year={year}&month={month}&currency=IDR").json()
    tx_ids: list[int] = []
    try:
        tx_ids.append(
            _create_tx(
                auth_client,
                occurred_at=occurred,
                tx_type="expense",
                category_id=int(tracked["id"]),
                amount="400",
                source_id=source_id,
                description=f"pytest-credit-tracked-{uuid4().hex[:8]}",
            )
        )
        tx_ids.append(
            _create_tx(
                auth_client,
                occurred_at=occurred,
                tx_type="expense",
                category_id=int(untracked["id"]),
                amount="700",
                source_id=source_id,
                description=f"pytest-credit-untracked-{uuid4().hex[:8]}",
            )
        )

        after = auth_client.get(f"/stats/overview?year={year}&month={month}&currency=IDR").json()
        before_credit = before["credit"]
        after_credit = after["credit"]
        assert (
            _to_decimal(after_credit["month_charges"]) - _to_decimal(before_credit["month_charges"])
            == Decimal("400")
        )
        assert (
            _to_decimal(after_credit["outstanding"]) - _to_decimal(before_credit["outstanding"])
            == Decimal("-400")
        )
    finally:
        for tx_id in tx_ids:
            auth_client.delete(f"/transactions/{tx_id}")
        auth_client.delete(f"/sources/{source_id}")
