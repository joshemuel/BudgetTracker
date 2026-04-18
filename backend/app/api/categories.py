from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import Category, Subscription, Transaction, User
from app.schemas.common import CategoryIn, CategoryOut, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(Category)
        .filter_by(user_id=user.id)
        .order_by(Category.name)
        .all()
    )


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cat = Category(user_id=user.id, name=payload.name, is_default=False)
    db.add(cat)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"Category '{payload.name}' already exists")
    db.refresh(cat)
    return cat


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cat = db.query(Category).filter_by(id=category_id, user_id=user.id).one_or_none()
    if cat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(cat, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Name conflict")
    db.refresh(cat)
    return cat


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cat = db.query(Category).filter_by(id=category_id, user_id=user.id).one_or_none()
    if cat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    in_use = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.category_id == category_id, Transaction.user_id == user.id)
        .scalar()
    )
    if in_use:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Category has {in_use} transactions"
        )

    sub_use = (
        db.query(func.count(Subscription.id))
        .filter(Subscription.category_id == category_id, Subscription.user_id == user.id)
        .scalar()
    )
    if sub_use:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Category has {sub_use} subscriptions"
        )

    db.delete(cat)
    db.commit()
