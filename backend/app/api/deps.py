from collections.abc import Iterator

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.models import User
from app.db.session import SessionLocal
from app.services.auth import resolve_session

SESSION_COOKIE = "session"


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: Session = Depends(get_db),
) -> User:
    if not session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    user = resolve_session(db, session)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")
    return user
