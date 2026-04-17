from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import Category, Source, Transaction, User
from app.schemas.common import TransferIn, TransactionIn, TransactionOut, TransactionUpdate
from app.services import fx

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _to_out(t: Transaction, cats: dict[int, str], srcs: dict[int, str]) -> TransactionOut:
    return TransactionOut(
        id=t.id,
        occurred_at=t.occurred_at,
        type=t.type,  # type: ignore[arg-type]
        category_id=t.category_id,
        category_name=cats.get(t.category_id, ""),
        amount=t.amount,
        source_id=t.source_id,
        source_name=srcs.get(t.source_id, ""),
        description=t.description,
        transfer_group_id=t.transfer_group_id,
        subscription_charge_id=t.subscription_charge_id,
    )


def _name_maps(db: Session, user_id: int) -> tuple[dict[int, str], dict[int, str]]:
    cats = {c.id: c.name for c in db.query(Category).filter_by(user_id=user_id).all()}
    srcs = {s.id: s.name for s in db.query(Source).filter_by(user_id=user_id).all()}
    return cats, srcs


@router.get("", response_model=list[TransactionOut])
def list_transactions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    category_id: int | None = None,
    source_id: int | None = None,
    q: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
):
    stmt = db.query(Transaction).filter(
        Transaction.user_id == user.id, Transaction.deleted_at.is_(None)
    )
    if from_ is not None:
        stmt = stmt.filter(Transaction.occurred_at >= from_)
    if to is not None:
        stmt = stmt.filter(Transaction.occurred_at < to)
    if category_id is not None:
        stmt = stmt.filter(Transaction.category_id == category_id)
    if source_id is not None:
        stmt = stmt.filter(Transaction.source_id == source_id)
    if q:
        stmt = stmt.filter(Transaction.description.ilike(f"%{q}%"))
    rows = (
        stmt.order_by(Transaction.occurred_at.desc(), Transaction.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    cats, srcs = _name_maps(db, user.id)
    return [_to_out(t, cats, srcs) for t in rows]


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_refs(db, user.id, payload.category_id, payload.source_id)
    t = Transaction(user_id=user.id, **payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    cats, srcs = _name_maps(db, user.id)
    return _to_out(t, cats, srcs)


@router.post("/transfer", response_model=list[TransactionOut], status_code=status.HTTP_201_CREATED)
def create_transfer(
    payload: TransferIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Amount must be positive")
    if payload.from_source_id == payload.to_source_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Source must be different")

    from_src = db.query(Source).filter_by(id=payload.from_source_id, user_id=user.id).one_or_none()
    to_src = db.query(Source).filter_by(id=payload.to_source_id, user_id=user.id).one_or_none()
    if from_src is None or to_src is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown source")

    topup_cat = db.query(Category).filter_by(user_id=user.id, name="Top-up").one_or_none()
    if topup_cat is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Top-up category not found")

    rates = fx.get_rates_cached(db)
    amount_from = Decimal(payload.amount)
    amount_to = (
        amount_from
        if from_src.currency == to_src.currency
        else fx.convert(amount_from, from_src.currency, to_src.currency, rates)
    )

    gid = uuid4()
    desc = payload.description.strip() if payload.description else None
    exp_desc = desc or f"Transfer to {to_src.name}"
    inc_desc = desc or f"Transfer from {from_src.name}"

    expense = Transaction(
        user_id=user.id,
        occurred_at=payload.occurred_at,
        type="expense",
        category_id=topup_cat.id,
        amount=amount_from,
        source_id=from_src.id,
        description=exp_desc,
        transfer_group_id=gid,
        is_internal=True,
    )
    income = Transaction(
        user_id=user.id,
        occurred_at=payload.occurred_at,
        type="income",
        category_id=topup_cat.id,
        amount=amount_to,
        source_id=to_src.id,
        description=inc_desc,
        transfer_group_id=gid,
        is_internal=True,
    )
    db.add(expense)
    db.add(income)
    db.commit()
    db.refresh(expense)
    db.refresh(income)

    cats, srcs = _name_maps(db, user.id)
    return [_to_out(expense, cats, srcs), _to_out(income, cats, srcs)]


@router.patch("/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = (
        db.query(Transaction)
        .filter(
            and_(
                Transaction.id == transaction_id,
                Transaction.user_id == user.id,
                Transaction.deleted_at.is_(None),
            )
        )
        .one_or_none()
    )
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data or "source_id" in data:
        _validate_refs(
            db,
            user.id,
            data.get("category_id", t.category_id),
            data.get("source_id", t.source_id),
        )
    for k, v in data.items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    cats, srcs = _name_maps(db, user.id)
    return _to_out(t, cats, srcs)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.query(Transaction).filter_by(id=transaction_id, user_id=user.id).one_or_none()
    if t is None or t.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    t.deleted_at = datetime.now(timezone.utc)
    db.commit()


def _validate_refs(db: Session, user_id: int, category_id: int, source_id: int) -> None:
    if db.query(Category).filter_by(id=category_id, user_id=user_id).first() is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown category")
    if db.query(Source).filter_by(id=source_id, user_id=user_id).first() is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown source")
