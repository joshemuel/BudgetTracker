from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4


def test_source_off_transaction_routes_through_currency_default(auth_client):
    suffix = uuid4().hex[:8]
    source = auth_client.post(
        "/sources",
        json={"name": f"pytest_currency_route_{suffix}", "current_balance": "500", "currency": "SGD"},
    )
    assert source.status_code == 201, source.text
    source_id = source.json()["id"]
    category_id = auth_client.get("/categories").json()[0]["id"]

    original_me = auth_client.get("/auth/me").json()
    try:
        defaulted = auth_client.patch(
            "/currencies/SGD",
            json={"default_source_id": source_id},
        )
        assert defaulted.status_code == 200, defaulted.text

        disabled = auth_client.patch("/auth/me", json={"sources_enabled": False})
        assert disabled.status_code == 200, disabled.text

        created = auth_client.post(
            "/transactions",
            json={
                "occurred_at": datetime.now(timezone.utc).isoformat(),
                "type": "expense",
                "category_id": category_id,
                "amount": "12.50",
                "currency": "SGD",
                "description": "source-off currency route",
            },
        )
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["source_id"] == source_id
        assert body["currency"] == "SGD"
    finally:
        auth_client.patch("/auth/me", json={"sources_enabled": original_me["sources_enabled"]})
        if "body" in locals():
            auth_client.delete(f"/transactions/{body['id']}")
        auth_client.delete(f"/sources/{source_id}")


def test_source_off_rejects_transfer_endpoint(auth_client):
    sources = auth_client.get("/sources").json()
    assert len(sources) >= 2
    original_me = auth_client.get("/auth/me").json()
    try:
        auth_client.patch("/auth/me", json={"sources_enabled": False})
        transfer = auth_client.post(
            "/transactions/transfer",
            json={
                "occurred_at": datetime.now(timezone.utc).isoformat(),
                "amount": "10",
                "from_source_id": sources[0]["id"],
                "to_source_id": sources[1]["id"],
            },
        )
        assert transfer.status_code == 400
        assert "Enable Sources" in transfer.text
    finally:
        auth_client.patch("/auth/me", json={"sources_enabled": original_me["sources_enabled"]})


def test_preferences_default_source_updates_default_currency_source(auth_client):
    suffix = uuid4().hex[:8]
    source = auth_client.post(
        "/sources",
        json={
            "name": f"pytest_pref_default_{suffix}",
            "current_balance": "250",
            "currency": "SGD",
        },
    )
    assert source.status_code == 201, source.text
    source_id = source.json()["id"]
    original_me = auth_client.get("/auth/me").json()
    try:
        updated = auth_client.patch(
            "/auth/me",
            json={
                "default_currency": "SGD",
                "default_expense_source_id": source_id,
            },
        )
        assert updated.status_code == 200, updated.text

        currency = auth_client.get("/currencies").json()
        sgd = next(row for row in currency if row["currency"] == "SGD")
        assert sgd["default_source_id"] == source_id
    finally:
        auth_client.patch(
            "/auth/me",
            json={
                "default_currency": original_me["default_currency"],
                "default_expense_source_id": original_me["default_expense_source_id"],
                "sources_enabled": original_me["sources_enabled"],
            },
        )
        auth_client.delete(f"/sources/{source_id}")
