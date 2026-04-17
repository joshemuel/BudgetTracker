from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import Category, Source, Transaction, User
from app.schemas.common import SourceIn, SourceOut, SourceUpdate
from app.services import fx

router = APIRouter(prefix="/sources", tags=["sources"])


def _round_currency(amount: Decimal, currency: str) -> Decimal:
    if currency in {"IDR", "JPY"}:
        return amount.quantize(Decimal("1"))
    return amount.quantize(Decimal("0.01"))


def _current_balance_map(db: Session, user_id: int) -> dict[int, Decimal]:
    stmt = (
        select(
            Transaction.source_id,
            func.sum(
                case(
                    (Transaction.type == "income", Transaction.amount),
                    else_=-Transaction.amount,
                )
            ),
        )
        .where(Transaction.user_id == user_id, Transaction.deleted_at.is_(None))
        .group_by(Transaction.source_id)
    )
    return {row[0]: (row[1] or Decimal("0")) for row in db.execute(stmt).all()}


def _to_out(src: Source, delta_by_source: dict[int, Decimal]) -> SourceOut:
    delta = delta_by_source.get(src.id, Decimal("0"))
    amount = _round_currency(src.starting_balance + delta, src.currency)
    return SourceOut(
        id=src.id,
        name=src.name,
        starting_balance=src.starting_balance,
        currency=src.currency,
        is_credit_card=src.is_credit_card,
        active=src.active,
        current_balance=amount,
    )


@router.get("", response_model=list[SourceOut])
def list_sources(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    include_inactive: bool = False,
):
    q = db.query(Source).filter_by(user_id=user.id)
    if not include_inactive:
        q = q.filter(Source.active.is_(True))
    sources = q.order_by(Source.name).all()
    deltas = _current_balance_map(db, user.id)
    return [_to_out(s, deltas) for s in sources]


@router.post("", response_model=SourceOut, status_code=status.HTTP_201_CREATED)
def create_source(
    payload: SourceIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    current_balance = data.pop("current_balance", None)
    currency = str(data.get("currency") or "IDR")
    if current_balance is not None:
        data["starting_balance"] = _round_currency(Decimal(current_balance), currency)
    else:
        data["starting_balance"] = _round_currency(
            Decimal(data.get("starting_balance", 0)), currency
        )
    src = Source(user_id=user.id, **data)
    db.add(src)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"Source '{payload.name}' already exists")
    db.refresh(src)
    return _to_out(src, _current_balance_map(db, user.id))


@router.patch("/{source_id}", response_model=SourceOut)
def update_source(
    source_id: int,
    payload: SourceUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    src = db.query(Source).filter_by(id=source_id, user_id=user.id).one_or_none()
    if src is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")

    updates = payload.model_dump(exclude_unset=True)
    current_balance = updates.pop("current_balance", None)

    new_currency = updates.get("currency")
    if new_currency and new_currency != src.currency:
        rates = fx.get_rates_cached(db)
        src_currency = src.currency or "IDR"
        dst_currency = str(new_currency)

        def _convert(amount: Decimal, c_from: str, c_to: str) -> Decimal:
            if c_from == c_to:
                return amount
            return _round_currency(fx.convert(amount, c_from, c_to, rates), c_to)

        src.starting_balance = _convert(Decimal(src.starting_balance), src_currency, dst_currency)
        txs = (
            db.query(Transaction)
            .filter(Transaction.user_id == user.id, Transaction.source_id == src.id)
            .all()
        )
        for t in txs:
            t.amount = _convert(Decimal(t.amount), src_currency, dst_currency)
        src.starting_balance = _round_currency(Decimal(src.starting_balance), dst_currency)
        for t in txs:
            t.amount = _round_currency(Decimal(t.amount), dst_currency)

    if "starting_balance" in updates:
        target_currency = str(updates.get("currency") or src.currency or "IDR")
        updates["starting_balance"] = _round_currency(
            Decimal(updates["starting_balance"]), target_currency
        )

    # Prevent direct starting_balance mutation from UI; use current_balance reset flow
    updates.pop("starting_balance", None)

    for k, v in updates.items():
        setattr(src, k, v)

    # When user manually resets current balance, log the delta as "Untracked"
    # so transaction history + balances remain reconcilable.
    if current_balance is not None:
        deltas_now = _current_balance_map(db, user.id)
        current_now = _round_currency(
            src.starting_balance + deltas_now.get(src.id, Decimal("0")), src.currency
        )
        target = _round_currency(Decimal(current_balance), src.currency)
        delta = target - current_now
        if delta != 0:
            untracked = (
                db.query(Category).filter_by(user_id=user.id, name="Untracked").one_or_none()
            )
            if untracked is not None:
                db.add(
                    Transaction(
                        user_id=user.id,
                        occurred_at=datetime.now(timezone.utc),
                        type="income" if delta > 0 else "expense",
                        category_id=untracked.id,
                        amount=abs(delta),
                        source_id=src.id,
                        description="Starting Budget",
                        is_internal=False,
                    )
                )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Name conflict")
    db.refresh(src)
    return _to_out(src, _current_balance_map(db, user.id))


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(
    source_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    src = db.query(Source).filter_by(id=source_id, user_id=user.id).one_or_none()
    if src is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    # If source has history, soft-delete by deactivating it.
    txn_count = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.source_id == source_id, Transaction.deleted_at.is_(None))
        .scalar()
    )
    if txn_count:
        src.active = False
        db.commit()
        return
    db.delete(src)
    db.commit()
