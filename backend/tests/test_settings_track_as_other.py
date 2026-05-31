from decimal import Decimal
from uuid import uuid4

from app.db.models import Category, Source, Transaction
from app.db.session import SessionLocal


def test_source_balance_change_tracked_as_other_vs_untrackable(auth_client):
    """A manual balance change records its delta under 'Other' when track_as_other
    is set (so it shows in summaries), and under 'Untrackable' otherwise."""
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    suffix = uuid4().hex[:8]

    created = auth_client.post(
        "/sources",
        json={"name": f"pytest_track_{suffix}", "current_balance": "1000", "currency": "IDR"},
    )
    assert created.status_code == 201, created.text
    source_id = created.json()["id"]

    try:
        # +200 tracked as Others -> "Other" category (income)
        r1 = auth_client.patch(
            f"/sources/{source_id}",
            json={"current_balance": "1200", "track_as_other": True},
        )
        assert r1.status_code == 200, r1.text

        # -100 with no flag -> default "Untrackable" category (expense)
        r2 = auth_client.patch(f"/sources/{source_id}", json={"current_balance": "1100"})
        assert r2.status_code == 200, r2.text

        with SessionLocal() as db:
            txs = (
                db.query(Transaction)
                .filter_by(user_id=user_id, source_id=source_id)
                .order_by(Transaction.id)
                .all()
            )
            by_cat: dict[str, list[Transaction]] = {}
            for t in txs:
                cat = db.get(Category, t.category_id)
                if cat is None:
                    continue
                by_cat.setdefault(cat.name, []).append(t)

        assert any(
            t.type == "income" and Decimal(t.amount) == Decimal("200")
            for t in by_cat.get("Other", [])
        ), by_cat.keys()
        assert any(
            t.type == "expense" and Decimal(t.amount) == Decimal("100")
            for t in by_cat.get("Untrackable", [])
        ), by_cat.keys()
    finally:
        with SessionLocal() as db:
            db.query(Transaction).filter(Transaction.source_id == source_id).delete(
                synchronize_session=False
            )
            db.query(Source).filter(Source.id == source_id).delete(synchronize_session=False)
            db.commit()
