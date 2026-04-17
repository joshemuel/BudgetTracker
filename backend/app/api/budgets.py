from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import Budget, Category, User
from app.schemas.common import BudgetIn, BudgetOut, BudgetUpdate

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _to_out(b: Budget, cat_name_by_id: dict[int, str]) -> BudgetOut:
    return BudgetOut(
        id=b.id,
        category_id=b.category_id,
        category_name=cat_name_by_id.get(b.category_id, ""),
        monthly_limit=b.monthly_limit,
        currency=b.currency,
    )


@router.get("", response_model=list[BudgetOut])
def list_budgets(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    budgets = db.query(Budget).filter_by(user_id=user.id).all()
    cats = {c.id: c.name for c in db.query(Category).filter_by(user_id=user.id).all()}
    return [_to_out(b, cats) for b in budgets]


@router.post("", response_model=BudgetOut, status_code=status.HTTP_201_CREATED)
def create_budget(
    payload: BudgetIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cat = db.query(Category).filter_by(id=payload.category_id, user_id=user.id).one_or_none()
    if cat is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown category")
    currency = payload.currency or user.default_currency or "IDR"
    b = Budget(
        user_id=user.id,
        category_id=payload.category_id,
        monthly_limit=payload.monthly_limit,
        currency=currency,
    )
    db.add(b)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Budget for this category already exists")
    db.refresh(b)
    return _to_out(b, {cat.id: cat.name})


@router.patch("/{budget_id}", response_model=BudgetOut)
def update_budget(
    budget_id: int,
    payload: BudgetUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    b = db.query(Budget).filter_by(id=budget_id, user_id=user.id).one_or_none()
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Budget not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(b, k, v)
    db.commit()
    db.refresh(b)
    cat = db.get(Category, b.category_id)
    return _to_out(b, {cat.id: cat.name} if cat else {})


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(
    budget_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    b = db.query(Budget).filter_by(id=budget_id, user_id=user.id).one_or_none()
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Budget not found")
    db.delete(b)
    db.commit()
