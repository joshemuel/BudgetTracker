"""Defaults for freshly created users (e.g. via Google sign-up).

Mirrors the category/source seeding that `seed/import_xlsx.py` does for the
primary account, so a newly approved user lands on a usable dashboard.
"""

from sqlalchemy.orm import Session

from app.db.models import (
    DEFAULT_CATEGORIES,
    Category,
    CurrencySourceDefault,
    Source,
    User,
)


def seed_new_user_defaults(db: Session, user: User) -> None:
    if db.query(Category).filter_by(user_id=user.id).count() == 0:
        for name in DEFAULT_CATEGORIES:
            db.add(Category(user_id=user.id, name=name, is_default=True))

    if db.query(Source).filter_by(user_id=user.id).count() == 0:
        currency = (user.default_currency or "IDR").upper()
        src = Source(user_id=user.id, name="Cash", currency=currency)
        db.add(src)
        db.flush()
        user.default_expense_source_id = src.id
        db.add(CurrencySourceDefault(user_id=user.id, currency=currency, source_id=src.id))

    db.flush()
