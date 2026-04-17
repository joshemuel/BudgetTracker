from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import SESSION_COOKIE, get_current_user, get_db
from app.config import get_settings
from app.db.models import SessionToken, Source, User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    UserOut,
    UserPreferencesUpdate,
)
from app.services.auth import SESSION_TTL, create_session, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=UserOut)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(username=payload.username).one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    token = create_session(db, user)
    db.commit()
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token.token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=get_settings().session_cookie_secure,
    )
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(SessionToken).filter_by(user_id=user.id).delete()
    db.commit()
    response.delete_cookie(SESSION_COOKIE)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UserPreferencesUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if "default_currency" in payload.model_fields_set and payload.default_currency is not None:
        cur = payload.default_currency.upper()
        if cur not in {"IDR", "SGD", "JPY", "AUD", "TWD"}:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported currency")
        user.default_currency = cur

    if "default_expense_source_id" in payload.model_fields_set:
        if payload.default_expense_source_id is None:
            user.default_expense_source_id = None
        else:
            src = (
                db.query(Source)
                .filter_by(id=payload.default_expense_source_id, user_id=user.id, active=True)
                .one_or_none()
            )
            if src is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown source")
            user.default_expense_source_id = src.id

    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be at least 8 characters")
    user.password_hash = hash_password(payload.new_password)
    db.query(SessionToken).filter_by(user_id=user.id).delete()
    db.commit()
    response.delete_cookie(SESSION_COOKIE)
