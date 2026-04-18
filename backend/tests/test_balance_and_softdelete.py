"""Money-handling invariants: balance computation and soft-delete reversal.

These tests run against the live seeded DB. They create a dedicated test source,
log a transaction, assert the computed balance reflects it, soft-delete the
transaction, and assert the balance returns to the starting value. The source
is torn down at the end.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import Source, Transaction

TEST_SOURCE_NAME = "pytest_temp_source"


def _hard_cleanup(db: Session) -> None:
    src_ids = [s.id for s in db.query(Source).filter_by(name=TEST_SOURCE_NAME).all()]
    if not src_ids:
        return
    db.query(Transaction).filter(Transaction.source_id.in_(src_ids)).delete(
        synchronize_session=False
    )
    db.query(Source).filter(Source.id.in_(src_ids)).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def clean_test_source(db: Session):
    _hard_cleanup(db)
    yield
    _hard_cleanup(db)


def test_balance_reflects_transactions_and_soft_delete(auth_client: TestClient, clean_test_source):
    # Create a source with a known starting balance
    r = auth_client.post(
        "/sources",
        json={"name": TEST_SOURCE_NAME, "starting_balance": "1000.00"},
    )
    assert r.status_code == 201, r.text
    src = r.json()
    assert Decimal(src["current_balance"]) == Decimal("1000.00")
    src_id = src["id"]

    # Use any existing category (Food is seeded)
    cats = auth_client.get("/categories").json()
    food = next(c for c in cats if c["name"] == "Food")

    # Log an expense → balance should drop
    r = auth_client.post(
        "/transactions",
        json={
            "occurred_at": "2026-04-17T10:00:00Z",
            "type": "expense",
            "category_id": food["id"],
            "amount": "250.00",
            "source_id": src_id,
            "description": "test expense",
        },
    )
    assert r.status_code == 201, r.text
    txn = r.json()

    r = auth_client.get("/sources")
    src_after_expense = next(s for s in r.json() if s["id"] == src_id)
    assert Decimal(src_after_expense["current_balance"]) == Decimal("750.00")

    # Log an income → balance should rise
    salary = next(c for c in cats if c["name"] == "Salary")
    r = auth_client.post(
        "/transactions",
        json={
            "occurred_at": "2026-04-17T10:01:00Z",
            "type": "income",
            "category_id": salary["id"],
            "amount": "500.00",
            "source_id": src_id,
        },
    )
    assert r.status_code == 201
    income_txn = r.json()

    src_after_income = next(s for s in auth_client.get("/sources").json() if s["id"] == src_id)
    assert Decimal(src_after_income["current_balance"]) == Decimal("1250.00")

    # Soft-delete the expense → balance should rise by 250
    r = auth_client.delete(f"/transactions/{txn['id']}")
    assert r.status_code == 204
    src_after_delete = next(s for s in auth_client.get("/sources").json() if s["id"] == src_id)
    assert Decimal(src_after_delete["current_balance"]) == Decimal("1500.00")

    # Soft-deleted transaction should not appear in listings
    listed_ids = [
        t["id"]
        for t in auth_client.get(f"/transactions?source_id={src_id}").json()["items"]
    ]
    assert txn["id"] not in listed_ids
    assert income_txn["id"] in listed_ids


def test_deleting_source_with_transactions_deactivates_source(
    auth_client: TestClient, clean_test_source
):
    r = auth_client.post("/sources", json={"name": TEST_SOURCE_NAME, "starting_balance": "0"})
    src_id = r.json()["id"]
    food = next(c for c in auth_client.get("/categories").json() if c["name"] == "Food")
    auth_client.post(
        "/transactions",
        json={
            "occurred_at": "2026-04-17T10:00:00Z",
            "type": "expense",
            "category_id": food["id"],
            "amount": "10.00",
            "source_id": src_id,
        },
    )

    r = auth_client.delete(f"/sources/{src_id}")
    assert r.status_code == 204

    listed_active = auth_client.get("/sources").json()
    assert all(s["id"] != src_id for s in listed_active)

    listed_all = auth_client.get("/sources?include_inactive=true").json()
    source_row = next(s for s in listed_all if s["id"] == src_id)
    assert source_row["active"] is False
