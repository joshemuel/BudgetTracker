from datetime import date
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db.models import SubscriptionCharge, User
from app.services import subscriptions as sub_svc


def test_skip_callback_falls_back_to_send_message_when_edit_fails(
    auth_client: TestClient,
    db,
    monkeypatch,
):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    categories = auth_client.get("/categories").json()
    assert categories
    category_id = int(categories[0]["id"])

    source_name = f"pytest_skip_cb_src_{uuid4().hex[:8]}"
    created_source = auth_client.post(
        "/sources",
        json={
            "name": source_name,
            "starting_balance": "0",
            "currency": "IDR",
        },
    )
    assert created_source.status_code == 201, created_source.text
    source_id = int(created_source.json()["id"])

    today = date.today().isoformat()
    created_sub = auth_client.post(
        "/subscriptions",
        json={
            "name": f"pytest-skip-callback-{uuid4().hex[:8]}",
            "amount": "12345",
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
    assert created_sub.status_code == 201, created_sub.text
    sub_id = int(created_sub.json()["id"])

    try:
        trigger = auth_client.post("/subscriptions/_run_daily")
        assert trigger.status_code == 200, trigger.text

        pending = auth_client.get("/subscriptions/charges/pending")
        assert pending.status_code == 200, pending.text
        charge = next(c for c in pending.json() if int(c["subscription_id"]) == sub_id)
        charge_id = int(charge["id"])

        calls: dict[str, list] = {"edit": [], "send": []}

        def fake_answer_callback_query(callback_query_id: str, text: str | None = None) -> bool:
            return True

        def fake_edit_message_text(chat_id: int | str, message_id: int, text: str) -> bool:
            calls["edit"].append((chat_id, message_id, text))
            return False

        def fake_send_message(
            chat_id: int | str,
            text: str,
            reply_markup: dict | None = None,
        ) -> bool:
            calls["send"].append((chat_id, text, reply_markup))
            return True

        monkeypatch.setattr(
            "app.services.subscriptions.telegram.answer_callback_query",
            fake_answer_callback_query,
        )
        monkeypatch.setattr(
            "app.services.subscriptions.telegram.edit_message_text",
            fake_edit_message_text,
        )
        monkeypatch.setattr(
            "app.services.subscriptions.telegram.send_message",
            fake_send_message,
        )

        user = db.query(User).filter_by(id=user_id).one()
        sub_svc.handle_callback(
            db,
            user,
            {
                "id": "cb-skip-fallback",
                "data": f"sub:skip:{charge_id}",
                "message": {
                    "chat": {"id": 99887766},
                    "message_id": 4455,
                },
            },
        )

        updated_charge = db.query(SubscriptionCharge).filter_by(id=charge_id).one()
        assert updated_charge.status == "skipped"
        assert calls["edit"] == [(99887766, 4455, "— Skipped this billing.")]
        assert calls["send"] == [(99887766, "— Skipped this billing.", None)]
    finally:
        auth_client.delete(f"/subscriptions/{sub_id}")
        auth_client.delete(f"/sources/{source_id}")
