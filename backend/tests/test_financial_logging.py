from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.db.models import AppState, Budget, Category, Source, Transaction, User
from app.db.session import SessionLocal
from app.services import financial, fx


def _seed_fx_rates(db) -> None:
    payload = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "rates": {
            "USD": "1",
            "IDR": "16000",
            "SGD": "1",
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


def test_log_items_budget_note_includes_newly_inserted_expense(auth_client):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    category_name = f"pytest_budget_cat_{uuid4().hex[:8]}"
    created_cat = auth_client.post("/categories", json={"name": category_name})
    assert created_cat.status_code == 201, created_cat.text
    category = created_cat.json()

    created_budget = auth_client.post(
        "/budgets",
        json={"category_id": category["id"], "monthly_limit": "100"},
    )
    assert created_budget.status_code == 201, created_budget.text
    budget_id = created_budget.json()["id"]

    src_name = f"pytest_budget_src_{uuid4().hex[:8]}"
    source = auth_client.post(
        "/sources",
        json={"name": src_name, "starting_balance": "0", "currency": "IDR"},
    )
    assert source.status_code == 201, source.text
    source_name = source.json()["name"]
    tx_id: int | None = None

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            outcome = financial.log_items(
                db,
                user,
                [
                    {
                        "type": "Expense",
                        "category": category["name"],
                        "amount": 40,
                        "source": source_name,
                        "description": "budget-check",
                        "date": None,
                        "time": None,
                    }
                ],
            )
            tx_id = outcome.transaction_ids[0]

        assert len(outcome.budget_notes) == 1
        note = outcome.budget_notes[0]
        assert category_name in note
        assert "40" in note
    finally:
        with SessionLocal() as db:
            if tx_id is not None:
                db.query(Transaction).filter(Transaction.id == tx_id).delete(synchronize_session=False)
            db.query(Budget).filter(Budget.id == budget_id).delete(synchronize_session=False)
            db.query(Source).filter(Source.id == source.json()["id"]).delete(synchronize_session=False)
            db.query(Category).filter(Category.id == category["id"]).delete(synchronize_session=False)
            db.commit()


def test_log_items_budget_note_uses_transaction_month_and_budget_currency(auth_client):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    original_currency = me.get("default_currency", "IDR")

    category_name = f"pytest_budget_fx_cat_{uuid4().hex[:8]}"
    created_cat = auth_client.post("/categories", json={"name": category_name})
    assert created_cat.status_code == 201, created_cat.text
    category = created_cat.json()

    src_name = f"pytest_budget_fx_src_{uuid4().hex[:8]}"
    created_source = auth_client.post(
        "/sources",
        json={"name": src_name, "starting_balance": "0", "currency": "SGD"},
    )
    assert created_source.status_code == 201, created_source.text

    budget_id: int | None = None
    tx_id: int | None = None
    try:
        auth_client.patch("/auth/me", json={"default_currency": "IDR"})
        created_budget = auth_client.post(
            "/budgets",
            json={"category_id": category["id"], "monthly_limit": "160000"},
        )
        assert created_budget.status_code == 201, created_budget.text
        budget_id = created_budget.json()["id"]

        with SessionLocal() as db:
            _seed_fx_rates(db)
            user = db.query(User).filter_by(id=user_id).one()
            outcome = financial.log_items(
                db,
                user,
                [
                    {
                        "type": "Expense",
                        "category": category_name,
                        "amount": 10,
                        "source": src_name,
                        "description": "backdated-fx-budget-check",
                        "date": "15/04/2026",
                        "time": "12:00:00",
                    }
                ],
            )
            tx_id = outcome.transaction_ids[0]

        assert len(outcome.budget_notes) == 1
        note = outcome.budget_notes[0]
        assert category_name in note
        assert "160.000 / 160.000 (100%)" in note
    finally:
        with SessionLocal() as db:
            if tx_id is not None:
                db.query(Transaction).filter(Transaction.id == tx_id).delete(synchronize_session=False)
            if budget_id is not None:
                db.query(Budget).filter(Budget.id == budget_id).delete(synchronize_session=False)
            db.query(Source).filter(Source.id == created_source.json()["id"]).delete(
                synchronize_session=False
            )
            db.query(Category).filter(Category.id == category["id"]).delete(synchronize_session=False)
            db.commit()
        auth_client.patch("/auth/me", json={"default_currency": original_currency})


def test_log_items_maps_grocery_to_groceries_category(auth_client):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    src_name = f"pytest_grocery_src_{uuid4().hex[:8]}"
    source = auth_client.post(
        "/sources",
        json={"name": src_name, "starting_balance": "0", "currency": "IDR"},
    )
    assert source.status_code == 201, source.text
    tx_id: int | None = None

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            outcome = financial.log_items(
                db,
                user,
                [
                    {
                        "type": "Expense",
                        "category": "Grocery",
                        "amount": 25000,
                        "source": source.json()["name"],
                        "description": "weekly",
                        "date": None,
                        "time": None,
                    }
                ],
            )
            tx_id = outcome.transaction_ids[0]
            tx = db.query(Transaction).filter(Transaction.id == tx_id).one()
            cat = db.query(Category).filter(Category.id == tx.category_id).one()

        assert cat.name == "Groceries"
    finally:
        with SessionLocal() as db:
            if tx_id is not None:
                db.query(Transaction).filter(Transaction.id == tx_id).delete(synchronize_session=False)
            db.query(Source).filter(Source.id == source.json()["id"]).delete(synchronize_session=False)
            db.commit()


def test_log_items_routes_explicit_currency_to_matching_source(auth_client):
    """'$300 SGD' with no named source must land on an SGD account, not record
    Rp 300 on the default IDR source."""
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    suffix = uuid4().hex[:8]

    idr = auth_client.post(
        "/sources",
        json={"name": f"pytest_route_idr_{suffix}", "starting_balance": "0", "currency": "IDR"},
    )
    assert idr.status_code == 201, idr.text
    sgd = auth_client.post(
        "/sources",
        json={"name": f"pytest_route_sgd_{suffix}", "starting_balance": "0", "currency": "SGD"},
    )
    assert sgd.status_code == 201, sgd.text
    tx_id: int | None = None

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            outcome = financial.log_items(
                db,
                user,
                [
                    {
                        "type": "Expense",
                        "category": "Coffee",
                        "amount": 300,
                        "source": None,
                        "currency": "SGD",
                        "description": "coffee",
                        "date": None,
                        "time": None,
                    }
                ],
            )
            tx_id = outcome.transaction_ids[0]
            tx = db.query(Transaction).filter(Transaction.id == tx_id).one()
            src = db.query(Source).filter(Source.id == tx.source_id).one()

        assert tx.currency == "SGD"
        assert src.currency == "SGD"
        assert tx.amount == Decimal("300")
    finally:
        with SessionLocal() as db:
            if tx_id is not None:
                db.query(Transaction).filter(Transaction.id == tx_id).delete(
                    synchronize_session=False
                )
            db.query(Source).filter(
                Source.id.in_([idr.json()["id"], sgd.json()["id"]])
            ).delete(synchronize_session=False)
            db.commit()


def test_log_items_collapses_duplicate_budget_lines_per_category(auth_client):
    """Two expenses in the same category yield a single, final budget line."""
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    suffix = uuid4().hex[:8]

    category = auth_client.post("/categories", json={"name": f"pytest_dedupe_{suffix}"}).json()
    created_budget = auth_client.post(
        "/budgets",
        json={"category_id": category["id"], "monthly_limit": "1000"},
    )
    assert created_budget.status_code == 201, created_budget.text
    budget_id = created_budget.json()["id"]
    source = auth_client.post(
        "/sources",
        json={"name": f"pytest_dedupe_src_{suffix}", "starting_balance": "0", "currency": "IDR"},
    )
    assert source.status_code == 201, source.text
    tx_ids: list[int] = []

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            outcome = financial.log_items(
                db,
                user,
                [
                    {
                        "type": "Expense",
                        "category": category["name"],
                        "amount": 200,
                        "source": source.json()["name"],
                        "description": "first",
                        "date": None,
                        "time": None,
                    },
                    {
                        "type": "Expense",
                        "category": category["name"],
                        "amount": 300,
                        "source": source.json()["name"],
                        "description": "second",
                        "date": None,
                        "time": None,
                    },
                ],
            )
            tx_ids = list(outcome.transaction_ids)

        assert len(outcome.budget_notes) == 1
        note = outcome.budget_notes[0]
        assert "500 / 1.000" in note
    finally:
        with SessionLocal() as db:
            if tx_ids:
                db.query(Transaction).filter(Transaction.id.in_(tx_ids)).delete(
                    synchronize_session=False
                )
            db.query(Budget).filter(Budget.id == budget_id).delete(synchronize_session=False)
            db.query(Source).filter(Source.id == source.json()["id"]).delete(
                synchronize_session=False
            )
            db.query(Category).filter(Category.id == category["id"]).delete(
                synchronize_session=False
            )
            db.commit()


def test_log_items_chooses_credit_card_for_generic_credit_source_label(auth_client):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    suffix = uuid4().hex[:8]
    debit_name = f"pytest_debit_{suffix}"
    cc_name = f"pytest_credit_card_{suffix}"

    debit = auth_client.post(
        "/sources",
        json={"name": debit_name, "starting_balance": "0", "currency": "IDR"},
    )
    assert debit.status_code == 201, debit.text
    cc = auth_client.post(
        "/sources",
        json={
            "name": cc_name,
            "starting_balance": "0",
            "currency": "IDR",
            "is_credit_card": True,
        },
    )
    assert cc.status_code == 201, cc.text
    tx_id: int | None = None

    try:
        with SessionLocal() as db:
            user = db.query(User).filter_by(id=user_id).one()
            outcome = financial.log_items(
                db,
                user,
                [
                    {
                        "type": "Expense",
                        "category": "Food",
                        "amount": 120000,
                        "source": "credit card",
                        "description": "dinner",
                        "date": None,
                        "time": None,
                    }
                ],
            )
            tx_id = outcome.transaction_ids[0]
            tx = db.query(Transaction).filter(Transaction.id == tx_id).one()
            src = db.query(Source).filter(Source.id == tx.source_id).one()

        assert src.name == cc_name
    finally:
        with SessionLocal() as db:
            if tx_id is not None:
                db.query(Transaction).filter(Transaction.id == tx_id).delete(synchronize_session=False)
            db.query(Source).filter(Source.id.in_([debit.json()["id"], cc.json()["id"]])).delete(
                synchronize_session=False
            )
            db.commit()
