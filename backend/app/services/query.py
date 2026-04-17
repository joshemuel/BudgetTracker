"""Port of handleQuery — builds CSV-like context from the DB and asks Gemini."""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal
from io import StringIO

from sqlalchemy.orm import Session

from app.db.models import Budget, Category, Source, Transaction, User
from app.services import llm
from app.services.parse import now_local, tz

log = logging.getLogger(__name__)


def _tx_csv(db: Session, user_id: int) -> str:
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.deleted_at.is_(None))
        .order_by(Transaction.occurred_at.desc())
        .limit(500)
        .all()
    )
    cats = {c.id: c.name for c in db.query(Category).filter_by(user_id=user_id).all()}
    srcs = {s.id: s.name for s in db.query(Source).filter_by(user_id=user_id).all()}
    buf = StringIO()
    buf.write("Date,Time,Type,Category,Amount,Source,Description\n")
    z = tz()
    for r in rows:
        local = r.occurred_at.astimezone(z)
        desc = (r.description or "").replace(",", " ")
        buf.write(
            f"{local.strftime('%d/%m/%Y')},"
            f"{local.strftime('%H:%M:%S')},"
            f"{'Expense' if r.type == 'expense' else 'Income'},"
            f"{cats.get(r.category_id, '')},"
            f"{int(r.amount)},"
            f"{srcs.get(r.source_id, '')},"
            f"{desc}\n"
        )
    return buf.getvalue()


def _sources_csv(db: Session, user_id: int) -> str:
    rows = db.query(Source).filter_by(user_id=user_id, active=True).all()
    buf = StringIO()
    buf.write("Method,Currency,StartingBalance,IsCredit\n")
    for s in rows:
        buf.write(
            f"{s.name},{s.currency},{int(s.starting_balance)},"
            f"{'yes' if s.is_credit_card else 'no'}\n"
        )
    return buf.getvalue()


def _limits_csv(db: Session, user_id: int) -> str:
    buf = StringIO()
    buf.write("Category,MonthlyLimit\n")
    cats = {c.id: c.name for c in db.query(Category).filter_by(user_id=user_id).all()}
    for b in db.query(Budget).filter_by(user_id=user_id).all():
        buf.write(f"{cats.get(b.category_id, '')},{int(b.monthly_limit)}\n")
    return buf.getvalue()


def _credit_outstanding(db: Session, user_id: int) -> Decimal:
    from sqlalchemy import func

    cc = db.query(Source).filter_by(user_id=user_id, is_credit_card=True).all()
    if not cc:
        return Decimal("0")
    ids = [s.id for s in cc]
    start = sum((s.starting_balance for s in cc), Decimal("0"))
    income = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.source_id.in_(ids),
            Transaction.type == "income",
            Transaction.deleted_at.is_(None),
        )
        .scalar()
    )
    expense = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.source_id.in_(ids),
            Transaction.type == "expense",
            Transaction.deleted_at.is_(None),
        )
        .scalar()
    )
    balance = start + Decimal(income) - Decimal(expense)
    return balance if balance < 0 else Decimal("0")


def answer(db: Session, user: User, question: str) -> str:
    now = now_local()
    today_str = now.strftime("%d/%m/%Y")
    dow = now.strftime("%A")
    tx = _tx_csv(db, user.id)
    src = _sources_csv(db, user.id)
    lim = _limits_csv(db, user.id)
    credit = _credit_outstanding(db, user.id)
    credit_ctx = f"\nCredit Card Outstanding Balance: {int(credit)}\n" if credit < 0 else ""

    prompt = f"""
    You are Leo, a cheerful and concise personal budget assistant on Telegram.
    Keep responses short. No emojis. No bullet points. Conversational.

    Today is {dow}, {today_str}. Date format dd/MM/yyyy.

    User's transactions (Date,Time,Type,Category,Amount,Source,Description):
    {tx}

    Money sources:
    {src}

    Monthly budget limits:
    {lim}
    {credit_ctx}
    The user asks: "{question}"

    - Answer accurately using the data.
    - Format amounts with period thousand separators (150000 → 150.000). No currency symbols.
    - For "remaining budget", compute: limit - total spent this month in that category.
    - Keep answers SHORT. 1-3 sentences for simple questions.
    - If data is insufficient, say so.
    - Never use emojis.
    """
    try:
        return llm.call_query(prompt)
    except llm.LLMError as e:
        return f"Leo's AI is hiccuping: {e}"
