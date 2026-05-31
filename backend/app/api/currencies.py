from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.api.sources import _current_balance_map, _reconcile_category, _round_currency
from app.db.models import CurrencySourceDefault, Source, Transaction, User
from app.schemas.common import CurrencyOut, CurrencyUpdate
from app.services.currency_mode import default_source_for_currency, normalize_currency

router = APIRouter(prefix="/currencies", tags=["currencies"])


def _active_currency_sources(db: Session, user: User, currency: str | None = None) -> list[Source]:
    q = db.query(Source).filter_by(user_id=user.id, active=True)
    if currency is not None:
        q = q.filter(Source.currency == currency)
    return q.order_by(Source.currency, Source.name, Source.id).all()


def _currency_row(
    db: Session,
    user: User,
    currency: str,
    sources: list[Source],
    deltas: dict[int, Decimal],
) -> CurrencyOut:
    total = Decimal("0")
    for source in sources:
        total += Decimal(source.starting_balance) + deltas.get(source.id, Decimal("0"))
    default = default_source_for_currency(db, user, currency)
    return CurrencyOut(
        currency=currency,
        current_balance=_round_currency(total, currency),
        default_source_id=default.id if default else None,
        default_source_name=default.name if default else None,
        source_count=len(sources),
    )


def _sources_by_currency(sources: list[Source]) -> dict[str, list[Source]]:
    out: dict[str, list[Source]] = {}
    for source in sources:
        out.setdefault(normalize_currency(source.currency), []).append(source)
    return out


@router.get("", response_model=list[CurrencyOut])
def list_currencies(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sources = _active_currency_sources(db, user)
    deltas = _current_balance_map(db, user.id)
    return [
        _currency_row(db, user, currency, grouped, deltas)
        for currency, grouped in _sources_by_currency(sources).items()
    ]


@router.patch("/{currency}", response_model=CurrencyOut)
def update_currency(
    currency: str,
    payload: CurrencyUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    code = normalize_currency(currency)
    sources = _active_currency_sources(db, user, code)
    if not sources:
        raise HTTPException(404, "Currency not found")

    default = default_source_for_currency(db, user, code)
    if payload.default_source_id is not None:
        default = next((s for s in sources if s.id == payload.default_source_id), None)
        if default is None:
            raise HTTPException(400, "Default source must use this currency")
        row = (
            db.query(CurrencySourceDefault)
            .filter_by(user_id=user.id, currency=code)
            .one_or_none()
        )
        if row is None:
            db.add(CurrencySourceDefault(user_id=user.id, currency=code, source_id=default.id))
        else:
            row.source_id = default.id

    deltas = _current_balance_map(db, user.id)
    current = _currency_row(db, user, code, sources, deltas)
    if payload.current_balance is not None:
        if default is None:
            raise HTTPException(400, f"No default source for {code}")
        delta = _round_currency(Decimal(payload.current_balance), code) - Decimal(
            current.current_balance
        )
        if delta != 0:
            category = _reconcile_category(db, user.id, payload.track_as_other)
            if category is None:
                raise HTTPException(400, "Reconciliation category is missing")
            db.add(
                Transaction(
                    user_id=user.id,
                    occurred_at=datetime.now(timezone.utc),
                    type="income" if delta > 0 else "expense",
                    category_id=category.id,
                    amount=abs(delta),
                    source_id=default.id,
                    currency=code,
                    description=None,
                    is_internal=False,
                )
            )

    db.commit()
    return _currency_row(db, user, code, sources, _current_balance_map(db, user.id))
