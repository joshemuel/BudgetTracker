"""Port of processFinancialMessage — takes parsed transaction items and writes
them to the DB, returns confirmations + budget notes in Leo's voice."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Budget, Category, Source, Transaction, User
from app.services.parse import (
    ensure_date,
    format_number,
    now_local,
    resolve_occurred_at,
    resolve_source_name,
)

log = logging.getLogger(__name__)

DEFAULT_SOURCE = "BCA"


@dataclass
class LogOutcome:
    confirmations: list[str]
    budget_notes: list[str]
    transaction_ids: list[int]

    def as_message(self) -> str:
        if not self.confirmations:
            return "Got the message, but couldn't extract any amounts. Try again?"
        if len(self.confirmations) == 1:
            msg = f"Logged: {self.confirmations[0]}."
        else:
            msg = f"Logged {len(self.confirmations)} transactions:\n" + "\n".join(
                f"{i + 1}. {c}" for i, c in enumerate(self.confirmations)
            )
        if self.budget_notes:
            msg += "\n\n" + "\n".join(self.budget_notes)
        return msg.strip()


def _monthly_status(
    db: Session, user_id: int, category_id: int
) -> tuple[Decimal, Decimal, str] | None:
    now = now_local()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month == 12:
        next_month = month_start.replace(year=now.year + 1, month=1)
    else:
        next_month = month_start.replace(month=now.month + 1)

    b = db.query(Budget).filter_by(user_id=user_id, category_id=category_id).one_or_none()
    if b is None:
        return None

    spent = db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user_id,
            Transaction.deleted_at.is_(None),
            Transaction.type == "expense",
            Transaction.category_id == category_id,
            Transaction.occurred_at >= month_start,
            Transaction.occurred_at < next_month,
        )
    ).scalar_one()
    spent = Decimal(spent)
    limit = Decimal(b.monthly_limit)
    if limit == 0:
        return spent, limit, "On Track"

    days_in_month = (next_month - month_start).days
    pct = float(spent / limit) * 100
    expected = (now.day / days_in_month) * 100
    if pct > 100:
        status = "Over"
    elif pct > expected + 10:
        status = "Behind"
    elif pct < expected - 10:
        status = "Ahead"
    else:
        status = "On Track"
    return spent, limit, status


def log_items(db: Session, user: User, items: list[dict[str, Any]]) -> LogOutcome:
    """Apply a batch of parsed transactions. Items shape:
      { type: "Income"|"Expense"|"expense"|"income",
        category: str,
        amount: int/str,
        source: str|None,
        description: str|None,
        date: "dd/MM/yyyy"|None,
        time: "HH:mm:ss"|None }
    Internal transfer-like pairs (same amount + date, one Expense + one Income)
    are linked via transfer_group_id.
    """
    categories = db.query(Category).filter_by(user_id=user.id).all()
    if not categories:
        fallback = Category(user_id=user.id, name="Other", is_default=False)
        db.add(fallback)
        db.flush()
        categories = [fallback]
    cat_by_name: dict[str, Category] = {c.name.lower(): c for c in categories}
    other_cat = cat_by_name.get("other") or categories[0]

    sources = db.query(Source).filter_by(user_id=user.id, active=True).all()
    src_by_name: dict[str, Source] = {s.name.lower(): s for s in sources}
    valid_names = [s.name for s in sources]
    preferred_src = None
    if user.default_expense_source_id is not None:
        preferred_src = next((s for s in sources if s.id == user.default_expense_source_id), None)
    currency_src = next(
        (
            s
            for s in sources
            if (s.currency or "IDR").upper() == (user.default_currency or "IDR").upper()
        ),
        None,
    )
    default_src = (
        preferred_src
        or currency_src
        or src_by_name.get(DEFAULT_SOURCE.lower())
        or (sources[0] if sources else None)
    )
    if default_src is None:
        raise RuntimeError("User has no sources defined")

    now = now_local()
    confirmations: list[str] = []
    budget_notes: list[str] = []
    created: list[Transaction] = []

    for item in items:
        amount_raw = item.get("amount")
        if not amount_raw:
            continue
        try:
            amount = Decimal(str(amount_raw))
        except Exception:
            continue
        if amount <= 0:
            continue

        t_type_raw = str(item.get("type", "expense")).strip().lower()
        t_type = "income" if t_type_raw.startswith("inc") else "expense"

        cat_name = str(item.get("category") or "").strip()
        category = cat_by_name.get(cat_name.lower(), other_cat)

        raw_src = item.get("source")
        fallback_name = default_src.name
        # For incomes, prefer explicit source or first active; for expenses use preferred default.
        if t_type == "income" and not raw_src and sources:
            fallback_name = sources[0].name
        resolved_name = resolve_source_name(raw_src, valid_names, fallback_name)
        source = src_by_name.get(resolved_name.lower(), default_src)
        used_default = not raw_src

        occurred = resolve_occurred_at(item.get("date"), item.get("time"), now)
        date_str = ensure_date(item.get("date"), now).strftime("%d/%m/%Y")

        description = item.get("description")
        if description is not None:
            description = str(description).strip() or None

        is_internal = item.get("is_internal", False) is True

        tx = Transaction(
            user_id=user.id,
            occurred_at=occurred,
            type=t_type,
            category_id=category.id,
            amount=amount,
            source_id=source.id,
            description=description,
            is_internal=is_internal,
        )
        db.add(tx)
        created.append(tx)

        conf = (
            f"{'Expense' if t_type == 'expense' else 'Income'} of "
            f"{format_number(amount)} for {category.name} on {date_str} "
            f"(source: {source.name}{' by default' if used_default else ''})"
        )
        confirmations.append(conf)

        if t_type == "expense":
            ms = _monthly_status(db, user.id, category.id)
            if ms is not None:
                spent, limit, status = ms
                if limit > 0:
                    pct = int(round(float(spent / limit) * 100))
                    budget_notes.append(
                        f"{category.name} Budget: {format_number(spent)} of "
                        f"{format_number(limit)} used ({pct}%) - {status}"
                    )

    # Transfer pair detection
    _link_transfers(created)

    db.commit()
    for tx in created:
        db.refresh(tx)

    return LogOutcome(
        confirmations=confirmations,
        budget_notes=budget_notes,
        transaction_ids=[t.id for t in created],
    )


def _link_transfers(created: list[Transaction]) -> None:
    def _looks_like_transfer(t: Transaction) -> bool:
        d = (t.description or "").strip().lower()
        return d.startswith("transfer to ") or d.startswith("transfer from ")

    txs = [t for t in created if _looks_like_transfer(t)]
    # pair each Expense with an Income of same amount+date
    pending: dict[tuple, Transaction] = {}
    for t in txs:
        key = (float(t.amount), t.occurred_at.date())
        if t.type == "expense" and key not in pending:
            pending[key] = t
        elif t.type == "income" and key in pending:
            other = pending.pop(key)
            gid = uuid4()
            other.transfer_group_id = gid
            t.transfer_group_id = gid
            other.is_internal = True
            t.is_internal = True


def soft_delete_last(db: Session, user: User) -> Transaction | None:
    t = (
        db.query(Transaction)
        .filter_by(user_id=user.id)
        .filter(Transaction.deleted_at.is_(None))
        .order_by(Transaction.occurred_at.desc(), Transaction.id.desc())
        .first()
    )
    if t is None:
        return None
    t.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return t
