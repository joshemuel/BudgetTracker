from fastapi.testclient import TestClient


def test_transactions_list_includes_pagination_metadata(auth_client: TestClient):
    r = auth_client.get("/transactions?limit=50&offset=0")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body.get("items"), list)
    assert isinstance(body.get("total"), int)
    assert body.get("limit") == 50
    assert body.get("offset") == 0
