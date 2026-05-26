from datetime import datetime, timezone, date
from decimal import Decimal
from uuid import uuid4

from app.db.models import AppState, Source, Transaction, User
from app.db.session import SessionLocal
from app.services import financial, fx, fx_historical


def _seed_today_fx_rates(db) -> None:
    payload = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "rates": {
            "USD": "1",
            "IDR": "16000",
            "SGD": "1.35",
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


def _clear_historical_cache(db) -> None:
    state = db.get(AppState, fx_historical.STATE_KEY)
    if state is not None:
        db.delete(state)
        db.commit()


def _mk_source(auth_client, name: str, currency: str) -> dict:
    resp = auth_client.post(
        "/sources",
        json={"name": name, "starting_balance": "0", "currency": currency},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _cleanup(tx_ids: list[int], source_ids: list[int]) -> None:
    with SessionLocal() as db:
        for tid in tx_ids:
            db.query(Transaction).filter(Transaction.id == tid).delete(synchronize_session=False)
        for sid in source_ids:
            db.query(Source).filter(Source.id == sid).delete(synchronize_session=False)
        db.commit()


def test_same_currency_transfer_pairs_without_fx(auth_client):
    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    suffix = uuid4().hex[:8]
    src_a = _mk_source(auth_client, f"pytest_a_{suffix}", "IDR")
    src_b = _mk_source(auth_client, f"pytest_b_{suffix}", "IDR")

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
                        "source": src_a["name"],
                        "description": f"Transfer to {src_b['name']}",
                        "date": None,
                        "time": None,
                        "is_internal": True,
                    },
                    {
                        "type": "Income",
                        "category": "Untrackable",
                        "amount": 50000,
                        "source": src_b["name"],
                        "description": f"Transfer from {src_a['name']}",
                        "date": None,
                        "time": None,
                        "is_internal": True,
                    },
                ],
            )
            tx_ids = list(outcome.transaction_ids)
            with SessionLocal() as db2:
                txs = db2.query(Transaction).filter(Transaction.id.in_(tx_ids)).all()
                assert len(txs) == 2
                assert all(t.transfer_group_id is not None for t in txs)
                assert {t.transfer_group_id for t in txs} == {txs[0].transfer_group_id}
                assert all(t.fx_rate is None for t in txs)
                # amounts unchanged
                assert all(t.amount == Decimal("50000") for t in txs)
    finally:
        _cleanup(tx_ids, [src_a["id"], src_b["id"]])


def test_cross_currency_transfer_applies_frankfurter_rate(auth_client, monkeypatch):
    """IDR → SGD using a mocked frankfurter response."""
    fake_rate = Decimal("0.0000968")

    def _fake_fetch(_d, src, dst, timeout=8.0):
        del timeout
        assert src == "IDR"
        assert dst == "SGD"
        return fake_rate

    monkeypatch.setattr(fx_historical, "_fetch_frankfurter", _fake_fetch)

    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    suffix = uuid4().hex[:8]
    bca = _mk_source(auth_client, f"pytest_BCA_{suffix}", "IDR")
    dbs = _mk_source(auth_client, f"pytest_DBS_{suffix}", "SGD")

    tx_ids: list[int] = []
    try:
        with SessionLocal() as db:
            _clear_historical_cache(db)
            user = db.query(User).filter_by(id=user_id).one()
            outcome = financial.log_items(
                db,
                user,
                [
                    {
                        "type": "Expense",
                        "category": "Untrackable",
                        "amount": 15108249,
                        "source": bca["name"],
                        "description": f"Transfer to {dbs['name']}",
                        "date": None,
                        "time": None,
                        "is_internal": True,
                    },
                    {
                        "type": "Income",
                        "category": "Untrackable",
                        "amount": 15108249,
                        "source": dbs["name"],
                        "description": f"Transfer from {bca['name']}",
                        "date": None,
                        "time": None,
                        "is_internal": True,
                    },
                ],
            )
            tx_ids = list(outcome.transaction_ids)

        with SessionLocal() as db:
            txs = (
                db.query(Transaction)
                .filter(Transaction.id.in_(tx_ids))
                .order_by(Transaction.type.desc())  # 'income' < 'expense' lex; sort desc → expense first? actually we filter explicitly
                .all()
            )
            by_type = {t.type: t for t in txs}
            expense = by_type["expense"]
            income = by_type["income"]
            assert expense.amount == Decimal("15108249")
            assert expense.fx_rate is None
            assert income.fx_rate is not None
            assert income.fx_rate == fake_rate.quantize(Decimal("0.0000000001"))
            expected = (Decimal("15108249") * fake_rate).quantize(Decimal("0.01"))
            assert income.amount == expected
            assert expense.transfer_group_id == income.transfer_group_id is not None
            assert expense.is_internal is True
            assert income.is_internal is True
    finally:
        _cleanup(tx_ids, [bca["id"], dbs["id"]])


def test_frankfurter_failure_falls_back_to_cached_rates(auth_client, monkeypatch):
    def _boom(*_args, **_kwargs):
        raise RuntimeError("frankfurter down")

    monkeypatch.setattr(fx_historical, "_fetch_frankfurter", _boom)

    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    suffix = uuid4().hex[:8]
    bca = _mk_source(auth_client, f"pytest_BCA_{suffix}", "IDR")
    dbs = _mk_source(auth_client, f"pytest_DBS_{suffix}", "SGD")

    tx_ids: list[int] = []
    try:
        with SessionLocal() as db:
            _clear_historical_cache(db)
            _seed_today_fx_rates(db)
            user = db.query(User).filter_by(id=user_id).one()
            outcome = financial.log_items(
                db,
                user,
                [
                    {
                        "type": "Expense", "category": "Untrackable",
                        "amount": 16000, "source": bca["name"],
                        "description": f"Transfer to {dbs['name']}",
                        "is_internal": True, "date": None, "time": None,
                    },
                    {
                        "type": "Income", "category": "Untrackable",
                        "amount": 16000, "source": dbs["name"],
                        "description": f"Transfer from {bca['name']}",
                        "is_internal": True, "date": None, "time": None,
                    },
                ],
            )
            tx_ids = list(outcome.transaction_ids)

        with SessionLocal() as db:
            txs = db.query(Transaction).filter(Transaction.id.in_(tx_ids)).all()
            income = next(t for t in txs if t.type == "income")
            # Cached rates: IDR=16000/USD, SGD=1.35/USD. Conversion: 16000 IDR -> 1 USD -> 1.35 SGD.
            # The rate stored is SGD-per-IDR = 1.35/16000 = 0.000084375
            assert income.fx_rate is not None
            assert income.amount == Decimal("1.35")
    finally:
        _cleanup(tx_ids, [bca["id"], dbs["id"]])


def test_twd_pair_uses_cached_fallback_without_calling_frankfurter(auth_client, monkeypatch):
    """TWD isn't in FRANKFURTER_SUPPORTED, so we skip the API entirely."""
    called = {"n": 0}

    def _fail_if_called(*_args, **_kwargs):
        called["n"] += 1
        raise AssertionError("frankfurter should not be called for TWD")

    monkeypatch.setattr(fx_historical, "_fetch_frankfurter", _fail_if_called)

    me = auth_client.get("/auth/me").json()
    user_id = int(me["id"])
    suffix = uuid4().hex[:8]
    bca = _mk_source(auth_client, f"pytest_BCA_{suffix}", "IDR")
    twd = _mk_source(auth_client, f"pytest_TWD_{suffix}", "TWD")

    tx_ids: list[int] = []
    try:
        with SessionLocal() as db:
            _clear_historical_cache(db)
            _seed_today_fx_rates(db)
            user = db.query(User).filter_by(id=user_id).one()
            outcome = financial.log_items(
                db,
                user,
                [
                    {
                        "type": "Expense", "category": "Untrackable",
                        "amount": 16000, "source": bca["name"],
                        "description": f"Transfer to {twd['name']}",
                        "is_internal": True, "date": None, "time": None,
                    },
                    {
                        "type": "Income", "category": "Untrackable",
                        "amount": 16000, "source": twd["name"],
                        "description": f"Transfer from {bca['name']}",
                        "is_internal": True, "date": None, "time": None,
                    },
                ],
            )
            tx_ids = list(outcome.transaction_ids)
        assert called["n"] == 0

        with SessionLocal() as db:
            txs = db.query(Transaction).filter(Transaction.id.in_(tx_ids)).all()
            income = next(t for t in txs if t.type == "income")
            # 16000 IDR -> 1 USD -> 32 TWD
            assert income.amount == Decimal("32.00")
            assert income.fx_rate is not None
    finally:
        _cleanup(tx_ids, [bca["id"], twd["id"]])


def test_fx_historical_caches_per_date(monkeypatch):
    """Second call for the same (date, src, dst) should not hit frankfurter again."""
    calls = {"n": 0}

    def _counting_fetch(*_args, **_kwargs):
        calls["n"] += 1
        return Decimal("0.0001")

    monkeypatch.setattr(fx_historical, "_fetch_frankfurter", _counting_fetch)

    with SessionLocal() as db:
        _clear_historical_cache(db)
        r1 = fx_historical.get_rate(db, date(2026, 1, 15), "IDR", "SGD")
        r2 = fx_historical.get_rate(db, date(2026, 1, 15), "IDR", "SGD")
    assert r1 == r2
    assert calls["n"] == 1
