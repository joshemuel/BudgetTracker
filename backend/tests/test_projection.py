from decimal import Decimal

from fastapi.testclient import TestClient


# Per-day "normal" spend amounts (IDR) seeded on days 1..10 of each prior month.
NORMAL_DAY_AMOUNTS = [8000, 9000, 9500, 10000, 10500, 11000, 11500, 12000, 13000, 14000]
NORMAL_SUM_PER_MONTH = sum(NORMAL_DAY_AMOUNTS)  # 108_500
OUTLIER_AMOUNT = 5_000_000  # one huge one-off per month, on day 15


def _seed_month(client: TestClient, category_id: int, source_id: int, year: int, month: int):
    created_ids: list[int] = []
    for day, amount in enumerate(NORMAL_DAY_AMOUNTS, start=1):
        r = client.post(
            "/transactions",
            json={
                "occurred_at": f"{year:04d}-{month:02d}-{day:02d}T10:00:00Z",
                "type": "expense",
                "category_id": category_id,
                "amount": str(amount),
                "source_id": source_id,
                "description": "proj-normal",
            },
        )
        assert r.status_code == 201, r.text
        created_ids.append(r.json()["id"])
    r = client.post(
        "/transactions",
        json={
            "occurred_at": f"{year:04d}-{month:02d}-15T10:00:00Z",
            "type": "expense",
            "category_id": category_id,
            "amount": str(OUTLIER_AMOUNT),
            "source_id": source_id,
            "description": "proj-outlier",
        },
    )
    assert r.status_code == 201, r.text
    created_ids.append(r.json()["id"])
    return created_ids


def test_projection_excludes_outlier_days(auth_client: TestClient):
    # Far-future months so we don't collide with seed data in the shared test DB.
    target_year, target_month = 2034, 1  # prior 3 months: 2033-10, -11, -12

    cat = auth_client.post("/categories", json={"name": "pytest_projection_cat"})
    assert cat.status_code in (201, 409), cat.text
    cat_id = next(
        c["id"] for c in auth_client.get("/categories").json()
        if c["name"] == "pytest_projection_cat"
    )
    source_id = auth_client.get("/sources").json()[0]["id"]

    created_ids: list[int] = []
    try:
        for (yy, mm) in ((2033, 10), (2033, 11), (2033, 12)):
            created_ids += _seed_month(auth_client, cat_id, source_id, yy, mm)

        r = auth_client.get(
            f"/stats/projection?year={target_year}&month={target_month}&currency=IDR"
        )
        assert r.status_code == 200, r.text
        body = r.json()

        assert body["currency"] == "IDR"
        assert body["months_used"] == 3
        # One huge outlier day per month is trimmed out by the IQR upper fence.
        assert body["days_excluded"] == 3

        avg = Decimal(body["avg_daily_expense"])
        # 2033-10/11/12 = 92 calendar days; 3 outlier days excluded => 89 kept.
        # avg = (3 * 108_500) / 89 ≈ 3657 IDR.
        assert Decimal("3500") <= avg <= Decimal("3800"), avg

        # The outliers, if NOT excluded, would push the mean to ~166k. Trimming
        # must keep the projection an order of magnitude below that.
        naive = (3 * NORMAL_SUM_PER_MONTH + 3 * OUTLIER_AMOUNT) / 92
        assert float(avg) < naive / 10
    finally:
        for tid in created_ids:
            auth_client.delete(f"/transactions/{tid}")
        auth_client.delete(f"/categories/{cat_id}")


def test_projection_profile_follows_shape_and_caps_outliers(auth_client: TestClient):
    # Far-future months so we don't collide with seed data in the shared test DB.
    target_year, target_month = 2035, 1  # prior 3 months: 2034-10, -11, -12

    cat = auth_client.post("/categories", json={"name": "pytest_proj_profile_cat"})
    assert cat.status_code in (201, 409), cat.text
    cat_id = next(
        c["id"] for c in auth_client.get("/categories").json()
        if c["name"] == "pytest_proj_profile_cat"
    )
    source_id = auth_client.get("/sources").json()[0]["id"]

    created_ids: list[int] = []
    try:
        for (yy, mm) in ((2034, 10), (2034, 11), (2034, 12)):
            created_ids += _seed_month(auth_client, cat_id, source_id, yy, mm)

        r = auth_client.get(
            f"/stats/projection?year={target_year}&month={target_month}&currency=IDR"
        )
        assert r.status_code == 200, r.text
        profile = r.json()["daily_profile"]

        # One entry per day of the target month (Jan 2035 = 31 days).
        assert len(profile) == 31

        # Days 1 and 10 carry the same normal spend in all three months, so the
        # profile reproduces that shape exactly.
        assert Decimal(profile[0]) == Decimal(NORMAL_DAY_AMOUNTS[0])  # day 1
        assert Decimal(profile[9]) == Decimal(NORMAL_DAY_AMOUNTS[9])  # day 10

        # Day 15 held a 5M one-off each month: it is *capped* at the IQR fence —
        # above the normal max but an order of magnitude below the raw outlier,
        # not flattened to zero.
        d15 = Decimal(profile[14])
        assert Decimal(NORMAL_DAY_AMOUNTS[-1]) < d15 < Decimal("100000"), d15

        # A genuinely quiet day stays at zero.
        assert Decimal(profile[19]) == Decimal("0")  # day 20
    finally:
        for tid in created_ids:
            auth_client.delete(f"/transactions/{tid}")
        auth_client.delete(f"/categories/{cat_id}")


def test_projection_no_prior_history_is_zero(auth_client: TestClient):
    # Prior months of 2037-06 (2037-03/04/05) have no data in the test DB.
    r = auth_client.get("/stats/projection?year=2037&month=6&currency=IDR")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["avg_daily_expense"] == "0"
    assert body["months_used"] == 0
    assert body["days_excluded"] == 0
    # Jun 2037 = 30 days, all flat at zero with no history to shape them.
    assert body["daily_profile"] == ["0"] * 30


def test_projection_rejects_unsupported_currency(auth_client: TestClient):
    r = auth_client.get("/stats/projection?currency=USD")
    assert r.status_code == 400
