"""Regression test for the web 'delete subscription' bug.

Confirming a charge materializes a Transaction that holds an FK back to the
charge (transactions.subscription_charge_id). Before the fix, deleting the
subscription cascaded into the charge rows while that RESTRICT FK still pointed
at them — raising an IntegrityError (HTTP 500) so the UI silently reverted.
The fix detaches those transactions first; this test locks that in.
"""

from datetime import date
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db.models import Subscription, Transaction


def test_delete_subscription_with_confirmed_charge_detaches_transaction(
    auth_client: TestClient,
    db,
):
    categories = auth_client.get("/categories").json()
    category_id = int(categories[0]["id"])

    source = auth_client.post(
        "/sources",
        json={"name": f"pytest_del_src_{uuid4().hex[:8]}", "starting_balance": "0", "currency": "IDR"},
    )
    assert source.status_code == 201, source.text
    source_id = int(source.json()["id"])

    today = date.today().isoformat()
    sub = auth_client.post(
        "/subscriptions",
        json={
            "name": f"pytest-del-{uuid4().hex[:8]}",
            "amount": "9999",
            "currency": "IDR",
            "source_id": source_id,
            "category_id": category_id,
            "billing_day": date.today().day,
            "frequency": "monthly",
            "active": True,
            "start_date": today,
            "next_billing_date": today,
        },
    )
    assert sub.status_code == 201, sub.text
    sub_id = int(sub.json()["id"])

    # Generate today's charge and confirm it → creates a linked transaction.
    assert auth_client.post("/subscriptions/_run_daily").status_code == 200
    pending = auth_client.get("/subscriptions/charges/pending").json()
    charge_id = int(next(c["id"] for c in pending if int(c["subscription_id"]) == sub_id))
    assert auth_client.post(f"/subscriptions/charges/{charge_id}/confirm").status_code in (200, 201)

    tx = (
        db.query(Transaction)
        .filter(Transaction.subscription_charge_id == charge_id)
        .one()
    )
    tx_id = tx.id

    # The delete that used to 500.
    resp = auth_client.delete(f"/subscriptions/{sub_id}")
    assert resp.status_code == 204, resp.text

    db.expire_all()
    assert db.get(Subscription, sub_id) is None
    surviving = db.get(Transaction, tx_id)
    assert surviving is not None, "the spending transaction must be preserved"
    assert surviving.subscription_charge_id is None, "back-reference must be detached"
