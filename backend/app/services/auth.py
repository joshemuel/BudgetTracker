import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from sqlalchemy.orm import Session

from app.db.models import SessionToken, User

SESSION_TTL = timedelta(days=30)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_session(db: Session, user: User) -> SessionToken:
    token = SessionToken(
        user_id=user.id,
        token=secrets.token_urlsafe(48),
        expires_at=datetime.now(timezone.utc) + SESSION_TTL,
    )
    db.add(token)
    db.flush()
    return token


def resolve_session(db: Session, token_value: str) -> User | None:
    token = db.query(SessionToken).filter_by(token=token_value).one_or_none()
    if token is None or token.expires_at < datetime.now(timezone.utc):
        return None
    return db.get(User, token.user_id)
