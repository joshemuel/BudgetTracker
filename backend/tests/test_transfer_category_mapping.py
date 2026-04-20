from uuid import uuid4

from app.db.models import Category, Source, Transaction, User
from app.db.session import SessionLocal
from app.services import financial


def _cleanup_sources(*names: str) -> None:
    with SessionLocal() as db:
        rows = db.query(Source).filter(Source.name.in_(list(names))).all()
        if not rows:
            return
        ids = [r.id for r in rows]
        db.query(Transaction).filter(Transaction.source_id.in_(ids)).delete(synchronize_session=False)
        for row in rows:
            db.delete(row)
        db.commit()


def _cleanup_category(name: str, user_id: int) -> None:
    with SessionLocal() as db:
        cat = db.query(Category).filter_by(user_id=user_id, name=name).one_or_none()
        if cat is None:
            return
        used = db.query(Transaction).filter(Transaction.category_id == cat.id).first()
        if used is not None:
            return
        db.delete(cat)
        db.commit()


def test_transfer_to_wallet_maps_to_top_up_category(auth_client):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    suffix = uuid4().hex[:8]
    from_name = f"pytest_xfer_bank_{suffix}"
    to_name = f"pytest_xfer_wallet_{suffix}"
    _cleanup_sources(from_name, to_name)

    from_src = auth_client.post(
        "/sources",
        json={"name": from_name, "starting_balance": "0", "currency": "IDR"},
    )
    to_src = auth_client.post(
        "/sources",
        json={"name": to_name, "starting_balance": "0", "currency": "IDR"},
    )
    assert from_src.status_code == 201
    assert to_src.status_code == 201

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
                        "category": "Untrackable",
                        "amount": 50000,
                        "source": from_name,
                        "description": f"Transfer to {to_name}",
                        "date": None,
                        "time": None,
                        "is_internal": True,
                    },
                    {
                        "type": "Income",
                        "category": "Untrackable",
                        "amount": 50000,
                        "source": to_name,
                        "description": f"Transfer from {from_name}",
                        "date": None,
                        "time": None,
                        "is_internal": True,
                    },
                ],
            )
            tx_ids = outcome.transaction_ids
            txs = db.query(Transaction).filter(Transaction.id.in_(tx_ids)).all()
            cat_ids = {t.category_id for t in txs}
            cats = db.query(Category).filter(Category.id.in_(cat_ids)).all()
            names = {c.name for c in cats}

        assert "Top-up" in names
    finally:
        with SessionLocal() as db:
            if tx_ids:
                db.query(Transaction).filter(Transaction.id.in_(tx_ids)).delete(synchronize_session=False)
                db.commit()
        _cleanup_sources(from_name, to_name)
        _cleanup_category("Top-up", user_id)


def test_transfer_to_savings_maps_to_investment_category(auth_client):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])

    suffix = uuid4().hex[:8]
    topup_name = "Top-up"
    from_name = f"pytest_xfer_cash_{suffix}"
    to_name = f"Savings Jar {suffix}"
    _cleanup_sources(from_name, to_name)

    from_src = auth_client.post(
        "/sources",
        json={"name": from_name, "starting_balance": "0", "currency": "IDR"},
    )
    to_src = auth_client.post(
        "/sources",
        json={"name": to_name, "starting_balance": "0", "currency": "IDR"},
    )
    created_topup = auth_client.post("/categories", json={"name": topup_name})
    assert created_topup.status_code in (201, 409), created_topup.text
    assert from_src.status_code == 201
    assert to_src.status_code == 201

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
                        "category": "Untrackable",
                        "amount": 60000,
                        "source": from_name,
                        "description": f"Transfer to {to_name}",
                        "date": None,
                        "time": None,
                        "is_internal": True,
                    },
                    {
                        "type": "Income",
                        "category": "Untrackable",
                        "amount": 60000,
                        "source": to_name,
                        "description": f"Transfer from {from_name}",
                        "date": None,
                        "time": None,
                        "is_internal": True,
                    },
                ],
            )
            tx_ids = outcome.transaction_ids
            txs = db.query(Transaction).filter(Transaction.id.in_(tx_ids)).all()
            cat_ids = {t.category_id for t in txs}
            cats = db.query(Category).filter(Category.id.in_(cat_ids)).all()
            names = {c.name for c in cats}

        assert "Investment" in names

        listed = auth_client.get("/categories").json()
        assert any(c["name"] == "Top-up" for c in listed)
    finally:
        with SessionLocal() as db:
            if tx_ids:
                db.query(Transaction).filter(Transaction.id.in_(tx_ids)).delete(synchronize_session=False)
                db.commit()
        _cleanup_sources(from_name, to_name)
