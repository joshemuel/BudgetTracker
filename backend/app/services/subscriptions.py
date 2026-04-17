"""Subscription scheduling: advance next_billing_date, spawn pending charges,
notify via Telegram, handle confirm/skip callbacks."""

from __future__ import annotations

import logging
from calendar import monthrange
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import Category, Source, Subscription, SubscriptionCharge, Transaction, User
from app.db.session import SessionLocal
from app.services import telegram
from app.services.parse import format_number, now_local

log = logging.getLogger(__name__)


def _safe_day(year: int, month: int, day: int) -> date:
    """Clamp day to month length (e.g. Feb 30 -> Feb 28/29)."""
    last = monthrange(year, month)[1]
    return date(year, month, min(day, last))


def advance_next_billing(sub: Subscription) -> date:
    d = sub.next_billing_date
    if sub.frequency == "yearly":
        try:
            return date(d.year + 1, d.month, d.day)
        except ValueError:
            return _safe_day(d.year + 1, d.month, d.day)
    # monthly
    month = d.month + 1
    year = d.year
    if month > 12:
        month = 1
        year += 1
    return _safe_day(year, month, sub.billing_day)


def _charge_keyboard(charge_id: int) -> dict:
    return {
        "inline_keyboard": [
            [
                {"text": "Confirm", "callback_data": f"sub:confirm:{charge_id}"},
                {"text": "Skip", "callback_data": f"sub:skip:{charge_id}"},
            ]
        ]
    }


def run_daily(db: Session | None = None) -> int:
    """Create pending charges for subscriptions due today and notify their owners.
    Returns the number of new charges created."""
    own_session = db is None
    if db is None:
        db = SessionLocal()
    created = 0
    try:
        today = now_local().date()
        subs = (
            db.query(Subscription)
            .filter(
                Subscription.active == True,  # noqa: E712
                Subscription.next_billing_date <= today,
            )
            .all()
        )
        for sub in subs:
            due = sub.next_billing_date
            existing = (
                db.query(SubscriptionCharge)
                .filter_by(subscription_id=sub.id, due_date=due)
                .one_or_none()
            )
            if existing is not None:
                continue
            charge = SubscriptionCharge(
                subscription_id=sub.id,
                due_date=due,
                status="pending",
                notified_at=datetime.now(timezone.utc),
            )
            db.add(charge)
            db.flush()

            user = db.get(User, sub.user_id)
            source = db.get(Source, sub.source_id)
            if user and user.telegram_chat_id and source:
                telegram.send_message(
                    user.telegram_chat_id,
                    f"{sub.name} — Rp {format_number(sub.amount)} on {source.name} "
                    f"is due today. Confirm or Skip?",
                    reply_markup=_charge_keyboard(charge.id),
                )
            created += 1
        db.commit()
    finally:
        if own_session:
            db.close()
    return created


def confirm_charge(db: Session, user: User, charge_id: int) -> Transaction | None:
    charge = (
        db.query(SubscriptionCharge)
        .join(Subscription, Subscription.id == SubscriptionCharge.subscription_id)
        .filter(SubscriptionCharge.id == charge_id, Subscription.user_id == user.id)
        .one_or_none()
    )
    if charge is None or charge.status != "pending":
        return None
    sub = db.get(Subscription, charge.subscription_id)
    if sub is None:
        return None

    occurred = datetime.combine(charge.due_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    tx = Transaction(
        user_id=user.id,
        occurred_at=occurred,
        type="expense",
        category_id=sub.category_id,
        amount=sub.amount,
        source_id=sub.source_id,
        description=f"{sub.name} (subscription)",
        subscription_charge_id=charge.id,
    )
    db.add(tx)
    db.flush()
    charge.transaction_id = tx.id
    charge.status = "confirmed"
    charge.resolved_at = datetime.now(timezone.utc)
    sub.last_billed_at = datetime.now(timezone.utc)
    sub.next_billing_date = advance_next_billing(sub)
    db.commit()
    db.refresh(tx)
    return tx


def skip_charge(db: Session, user: User, charge_id: int) -> SubscriptionCharge | None:
    charge = (
        db.query(SubscriptionCharge)
        .join(Subscription, Subscription.id == SubscriptionCharge.subscription_id)
        .filter(SubscriptionCharge.id == charge_id, Subscription.user_id == user.id)
        .one_or_none()
    )
    if charge is None or charge.status != "pending":
        return None
    sub = db.get(Subscription, charge.subscription_id)
    if sub is None:
        return None
    charge.status = "skipped"
    charge.resolved_at = datetime.now(timezone.utc)
    sub.next_billing_date = advance_next_billing(sub)
    db.commit()
    return charge


def handle_callback(db: Session, user: User, cb: dict[str, Any]) -> None:
    data = cb.get("data", "")
    message = cb.get("message", {})
    chat_id = message.get("chat", {}).get("id")
    message_id = message.get("message_id")
    parts = data.split(":")
    if len(parts) != 3 or parts[0] != "sub":
        telegram.answer_callback_query(cb["id"], "Unknown action.")
        return
    _, action, raw_id = parts
    try:
        charge_id = int(raw_id)
    except ValueError:
        telegram.answer_callback_query(cb["id"], "Bad charge id.")
        return

    if action == "confirm":
        tx = confirm_charge(db, user, charge_id)
        if tx is None:
            telegram.answer_callback_query(cb["id"], "Charge already resolved.")
            return
        telegram.answer_callback_query(cb["id"], "Confirmed.")
        if chat_id and message_id:
            telegram.edit_message_text(
                chat_id,
                message_id,
                f"✓ Charged {format_number(Decimal(tx.amount))} to your books.",
            )
    elif action == "skip":
        out = skip_charge(db, user, charge_id)
        if out is None:
            telegram.answer_callback_query(cb["id"], "Charge already resolved.")
            return
        telegram.answer_callback_query(cb["id"], "Skipped.")
        if chat_id and message_id:
            telegram.edit_message_text(chat_id, message_id, "— Skipped this billing.")
    else:
        telegram.answer_callback_query(cb["id"], "Unknown action.")
