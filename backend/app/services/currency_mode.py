from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Protocol

from sqlalchemy.orm import Session

from app.db.models import CurrencySourceDefault, Source, User


class SourceLike(Protocol):
    id: int
    currency: str
    active: bool


def normalize_currency(currency: str | None, fallback: str = "IDR") -> str:
    return (currency or fallback or "IDR").upper()


def resolve_entry_currency(
    *,
    sources_enabled: bool,
    explicit_currency: str | None,
    source_currency: str | None,
    default_currency: str | None,
) -> str:
    if sources_enabled:
        return normalize_currency(source_currency, normalize_currency(default_currency))
    return normalize_currency(explicit_currency, normalize_currency(default_currency))


def source_currency_rows(sources: Iterable[SourceLike]) -> dict[str, list[int]]:
    grouped: dict[str, list[int]] = defaultdict(list)
    for source in sources:
        if source.active:
            grouped[normalize_currency(source.currency)].append(source.id)
    return dict(grouped)


def default_source_for_currency(db: Session, user: User, currency: str) -> Source | None:
    code = normalize_currency(currency, normalize_currency(user.default_currency))
    row = (
        db.query(CurrencySourceDefault)
        .filter_by(user_id=user.id, currency=code)
        .one_or_none()
    )
    if row is not None:
        source = (
            db.query(Source)
            .filter_by(id=row.source_id, user_id=user.id, active=True)
            .one_or_none()
        )
        if source is not None and normalize_currency(source.currency) == code:
            return source

    return (
        db.query(Source)
        .filter_by(user_id=user.id, active=True)
        .filter(Source.currency == code)
        .order_by(Source.name, Source.id)
        .first()
    )
