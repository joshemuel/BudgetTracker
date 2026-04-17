from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import Category, Source, Subscription, SubscriptionCharge, User
from app.schemas.subscriptions import (
    ChargeOut,
    SubscriptionIn,
    SubscriptionMonthlyTotal,
    SubscriptionOut,
    SubscriptionUpdate,
)
from app.services import fx
from app.services import subscriptions as sub_svc

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

SUPPORTED_CURRENCIES = {"IDR", "SGD", "JPY", "AUD", "TWD"}


def _report_currency(user: User, currency: str | None) -> str:
    cur = (currency or user.default_currency or "IDR").upper()
    if cur not in SUPPORTED_CURRENCIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported currency")
    return cur


def _round_currency(v: Decimal, currency: str) -> Decimal:
    if currency in {"IDR", "JPY"}:
        return v.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _monthly_equivalent(amount: Decimal, frequency: str) -> Decimal:
    if frequency == "yearly":
        return amount / Decimal("12")
    return amount


def _name_maps(db: Session, user_id: int) -> tuple[dict[int, str], dict[int, str]]:
    cats = {c.id: c.name for c in db.query(Category).filter_by(user_id=user_id).all()}
    srcs = {s.id: s.name for s in db.query(Source).filter_by(user_id=user_id).all()}
    return cats, srcs


def _to_out(s: Subscription, cats: dict[int, str], srcs: dict[int, str]) -> SubscriptionOut:
    return SubscriptionOut(
        id=s.id,
        name=s.name,
        amount=s.amount,
        currency=s.currency,
        source_id=s.source_id,
        source_name=srcs.get(s.source_id, ""),
        category_id=s.category_id,
        category_name=cats.get(s.category_id, ""),
        billing_day=s.billing_day,
        frequency=s.frequency,  # type: ignore[arg-type]
        active=s.active,
        start_date=s.start_date,
        end_date=s.end_date,
        next_billing_date=s.next_billing_date,
        last_billed_at=s.last_billed_at,
    )


@router.get("/monthly-total", response_model=SubscriptionMonthlyTotal)
def monthly_total(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    currency: str | None = Query(default=None),
):
    report_currency = _report_currency(user, currency)
    rates = fx.get_rates_cached(db)
    subs = db.query(Subscription).filter_by(user_id=user.id, active=True).all()
    total = Decimal("0")
    for s in subs:
        monthly = _monthly_equivalent(Decimal(s.amount), s.frequency)
        total += fx.convert(monthly, s.currency or "IDR", report_currency, rates)
    return SubscriptionMonthlyTotal(
        total=_round_currency(total, report_currency),
        currency=report_currency,
    )


@router.get("", response_model=list[SubscriptionOut])
def list_subscriptions(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    rows = (
        db.query(Subscription)
        .filter_by(user_id=user.id)
        .order_by(Subscription.next_billing_date)
        .all()
    )
    cats, srcs = _name_maps(db, user.id)
    return [_to_out(s, cats, srcs) for s in rows]


@router.post("", response_model=SubscriptionOut, status_code=status.HTTP_201_CREATED)
def create_subscription(
    payload: SubscriptionIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_refs(db, user.id, payload.category_id, payload.source_id)
    next_billing = payload.next_billing_date or _first_billing_date(
        payload.start_date, payload.billing_day
    )
    sub = Subscription(
        user_id=user.id,
        name=payload.name,
        amount=payload.amount,
        currency=payload.currency,
        source_id=payload.source_id,
        category_id=payload.category_id,
        billing_day=payload.billing_day,
        frequency=payload.frequency,
        active=payload.active,
        start_date=payload.start_date,
        end_date=payload.end_date,
        next_billing_date=next_billing,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    cats, srcs = _name_maps(db, user.id)
    return _to_out(sub, cats, srcs)


@router.patch("/{sub_id}", response_model=SubscriptionOut)
def update_subscription(
    sub_id: int,
    payload: SubscriptionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sub = db.query(Subscription).filter_by(id=sub_id, user_id=user.id).one_or_none()
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Subscription not found")
    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data or "source_id" in data:
        _validate_refs(
            db,
            user.id,
            data.get("category_id", sub.category_id),
            data.get("source_id", sub.source_id),
        )
    for k, v in data.items():
        setattr(sub, k, v)
    db.commit()
    db.refresh(sub)
    cats, srcs = _name_maps(db, user.id)
    return _to_out(sub, cats, srcs)


@router.delete("/{sub_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subscription(
    sub_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sub = db.query(Subscription).filter_by(id=sub_id, user_id=user.id).one_or_none()
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Subscription not found")
    db.delete(sub)
    db.commit()


@router.get("/{sub_id}/charges", response_model=list[ChargeOut])
def list_charges(
    sub_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sub = db.query(Subscription).filter_by(id=sub_id, user_id=user.id).one_or_none()
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Subscription not found")
    rows = (
        db.query(SubscriptionCharge)
        .filter_by(subscription_id=sub_id)
        .order_by(SubscriptionCharge.due_date.desc())
        .all()
    )
    return [
        ChargeOut(
            id=c.id,
            subscription_id=c.subscription_id,
            subscription_name=sub.name,
            due_date=c.due_date,
            status=c.status,  # type: ignore[arg-type]
            transaction_id=c.transaction_id,
            notified_at=c.notified_at,
            resolved_at=c.resolved_at,
        )
        for c in rows
    ]


@router.get("/charges/pending", response_model=list[ChargeOut])
def list_pending(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    rows = (
        db.query(SubscriptionCharge, Subscription.name)
        .join(Subscription, Subscription.id == SubscriptionCharge.subscription_id)
        .filter(
            Subscription.user_id == user.id, SubscriptionCharge.status == "pending"
        )
        .order_by(SubscriptionCharge.due_date)
        .all()
    )
    return [
        ChargeOut(
            id=c.id,
            subscription_id=c.subscription_id,
            subscription_name=name,
            due_date=c.due_date,
            status=c.status,  # type: ignore[arg-type]
            transaction_id=c.transaction_id,
            notified_at=c.notified_at,
            resolved_at=c.resolved_at,
        )
        for c, name in rows
    ]


@router.post("/charges/{charge_id}/confirm")
def confirm(
    charge_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tx = sub_svc.confirm_charge(db, user, charge_id)
    if tx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Charge not pending")
    return {"transaction_id": tx.id}


@router.post("/charges/{charge_id}/skip")
def skip(
    charge_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = sub_svc.skip_charge(db, user, charge_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Charge not pending")
    return {"charge_id": c.id}


@router.post("/_run_daily")
def run_daily(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Manual trigger (admin) — runs the same scan APScheduler runs at 07:00."""
    del user
    created = sub_svc.run_daily(db)
    return {"created": created}


def _first_billing_date(start: date, billing_day: int) -> date:
    from app.services.subscriptions import _safe_day

    today = date.today()
    base = start if start > today else today
    candidate = _safe_day(base.year, base.month, billing_day)
    if candidate < base:
        # roll forward one month
        month = base.month + 1
        year = base.year
        if month > 12:
            month = 1
            year += 1
        candidate = _safe_day(year, month, billing_day)
    return candidate


def _validate_refs(db: Session, user_id: int, category_id: int, source_id: int) -> None:
    if db.query(Category).filter_by(id=category_id, user_id=user_id).first() is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown category")
    if db.query(Source).filter_by(id=source_id, user_id=user_id).first() is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown source")
