from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Category, Source, Transaction, User
from app.db.session import SessionLocal
from app.services import fx, telegram
from app.services.parse import format_number, tz

log = logging.getLogger(__name__)


def _week_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    local_now = now or datetime.now(tz())
    if local_now.tzinfo is None:
        local_now = local_now.replace(tzinfo=tz())
    else:
        local_now = local_now.astimezone(tz())
    start = (local_now - timedelta(days=local_now.weekday())).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    return start, start + timedelta(days=7)


def _excluded_category_ids(db: Session, user_id: int) -> set[int]:
    rows = db.execute(
        select(Category.id).where(
            Category.user_id == user_id,
            func.lower(Category.name).in_(("untrackable", "untracked")),
        )
    ).all()
    return {int(category_id) for category_id, in rows}


def _format_money(currency: str, amount: Decimal) -> str:
    prefix = "Rp " if currency.upper() == "IDR" else f"{currency.upper()} "
    return f"{prefix}{format_number(amount)}"


def _bar(value: Decimal, max_value: Decimal, width: int = 16) -> str:
    if value <= 0 or max_value <= 0:
        return "-"
    filled = max(1, min(width, int((value / max_value) * width)))
    return "#" * filled


def _chart_lines(
    title: str,
    rows: list[tuple[str, Decimal]],
    currency: str,
    max_rows: int | None = None,
) -> list[str]:
    visible = rows if max_rows is None else rows[:max_rows]
    if not visible:
        return [title, "  -"]
    max_value = max((value for _, value in visible), default=Decimal("0"))
    lines = [title]
    for label, value in visible:
        lines.append(f"  {label:<12} {_bar(value, max_value):<16} {_format_money(currency, value)}")
    return lines


def build_weekly_report(db: Session, user: User, now: datetime | None = None) -> str:
    start, end = _week_bounds(now)
    currency = (user.default_currency or "IDR").upper()
    excluded = _excluded_category_ids(db, user.id)
    rates = fx.get_rates_cached(db)

    conditions = [
        Transaction.user_id == user.id,
        Transaction.deleted_at.is_(None),
        Transaction.type == "expense",
        Transaction.is_internal.is_(False),
        Transaction.occurred_at >= start,
        Transaction.occurred_at < end,
    ]
    if excluded:
        conditions.append(~Transaction.category_id.in_(excluded))

    rows = db.execute(
        select(Transaction.occurred_at, Transaction.amount, Source.currency, Category.name)
        .join(Source, Source.id == Transaction.source_id)
        .join(Category, Category.id == Transaction.category_id)
        .where(*conditions)
    ).all()

    by_day: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    by_category: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    total = Decimal("0")
    for occurred_at, amount, source_currency, category_name in rows:
        local_occurred = occurred_at.astimezone(tz()) if occurred_at.tzinfo else occurred_at
        value = fx.convert(Decimal(amount), source_currency or "IDR", currency, rates)
        label = local_occurred.strftime("%a %d")
        by_day[label] += value
        by_category[str(category_name)] += value
        total += value

    title = f"Weekly report ({start.strftime('%d %b')} - {(end - timedelta(days=1)).strftime('%d %b')})"
    if total <= 0:
        return f"{title}\n\nNo tracked spending this week."

    day_rows: list[tuple[str, Decimal]] = []
    for i in range(7):
        day = start + timedelta(days=i)
        label = day.strftime("%a %d")
        day_rows.append((label, by_day.get(label, Decimal("0"))))
    category_rows = sorted(by_category.items(), key=lambda item: item[1], reverse=True)

    lines = [
        title,
        f"Total spent: {_format_money(currency, total)}",
        "",
        *_chart_lines("Daily spending", day_rows, currency),
        "",
        *_chart_lines("Category spending", category_rows, currency, max_rows=8),
    ]
    return "\n".join(lines)


def send_weekly_reports(now: datetime | None = None) -> int:
    sent = 0
    with SessionLocal() as db:
        users = (
            db.query(User)
            .filter(User.telegram_chat_id.isnot(None), User.telegram_chat_id != "")
            .all()
        )
        for user in users:
            if not user.telegram_chat_id:
                continue
            try:
                message = build_weekly_report(db, user, now=now)
                if telegram.send_message(user.telegram_chat_id, message):
                    sent += 1
            except Exception as e:
                log.exception("weekly report failed for user %s: %s", user.id, e)
    return sent
