from uuid import uuid4

from app.db.models import Budget, Category, Source, Transaction, User
from app.db.session import SessionLocal
from app.services import financial


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
        assert f"{category_name} Budget:" in note
        assert "40" in note
    finally:
        with SessionLocal() as db:
            if tx_id is not None:
                db.query(Transaction).filter(Transaction.id == tx_id).delete(synchronize_session=False)
            db.query(Budget).filter(Budget.id == budget_id).delete(synchronize_session=False)
            db.query(Source).filter(Source.id == source.json()["id"]).delete(synchronize_session=False)
            db.query(Category).filter(Category.id == category["id"]).delete(synchronize_session=False)
            db.commit()


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
