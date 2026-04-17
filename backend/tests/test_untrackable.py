from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient


def test_balance_reset_logs_untrackable_without_description(auth_client: TestClient):
    source_name = f"pytest_untrackable_src_{uuid4().hex[:8]}"
    create = auth_client.post(
        "/sources",
        json={"name": source_name, "starting_balance": "0", "currency": "IDR"},
    )
    assert create.status_code == 201, create.text
    src = create.json()
    src_id = src["id"]

    try:
        patch = auth_client.patch(f"/sources/{src_id}", json={"current_balance": "12345"})
        assert patch.status_code == 200, patch.text

        txs = auth_client.get(f"/transactions?source_id={src_id}&limit=20")
        assert txs.status_code == 200, txs.text
        rows = txs.json()
        assert rows, "expected at least one transaction after balance reset"

        t = rows[0]
        assert t["category_name"] in {"Untrackable", "Untracked"}
        assert t["description"] is None
        assert t["type"] == "income"
        assert Decimal(t["amount"]) == Decimal("12345")
    finally:
        auth_client.delete(f"/sources/{src_id}")
