from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import Source, Transaction, User
from app.schemas.common import SourceIn, SourceOut, SourceUpdate

router = APIRouter(prefix="/sources", tags=["sources"])


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
    return SourceOut(
        id=src.id,
        name=src.name,
        starting_balance=src.starting_balance,
        is_credit_card=src.is_credit_card,
        active=src.active,
        current_balance=src.starting_balance + delta,
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
    src = Source(user_id=user.id, **payload.model_dump())
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
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(src, k, v)
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
    # Refuse delete if transactions reference this source; deactivate instead.
    txn_count = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.source_id == source_id, Transaction.deleted_at.is_(None))
        .scalar()
    )
    if txn_count:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Source has {txn_count} transactions; set active=false instead of deleting",
        )
    db.delete(src)
    db.commit()
