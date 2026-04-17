from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import Budget, Category, Source, Transaction, User
from app.services import fx

router = APIRouter(prefix="/stats", tags=["stats"])


def _idr_round(v: Decimal) -> Decimal:
    return v.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


def _category_spent(
    db: Session, user_id: int, start: datetime, end: datetime, rates: fx.FxRates
) -> dict[int, Decimal]:
    rows = db.execute(
        select(Transaction.category_id, Transaction.amount, Source.currency)
        .join(Source, Source.id == Transaction.source_id)
        .where(
            Transaction.user_id == user_id,
            Transaction.deleted_at.is_(None),
            Transaction.type == "expense",
            Transaction.is_internal.is_(False),
            Transaction.occurred_at >= start,
            Transaction.occurred_at < end,
        )
    ).all()
    out: dict[int, Decimal] = {}
    for category_id, amount, currency in rows:
        out[category_id] = out.get(category_id, Decimal("0")) + fx.convert_to_idr(
            Decimal(amount), currency or "IDR", rates
        )
    return out


def _credit_summary(
    db: Session, user_id: int, start: datetime, end: datetime, rates: fx.FxRates
) -> dict:
    cc_sources = db.query(Source).filter_by(user_id=user_id, is_credit_card=True).all()
    if not cc_sources:
        return {"outstanding": "0", "month_charges": "0", "month_payments": "0"}
    cc_ids = [s.id for s in cc_sources]
    curr_by_id = {s.id: s.currency or "IDR" for s in cc_sources}

    outstanding = Decimal("0")
    for s in cc_sources:
        outstanding += fx.convert_to_idr(Decimal(s.starting_balance), s.currency or "IDR", rates)

    all_rows = db.execute(
        select(Transaction.source_id, Transaction.type, Transaction.amount).where(
            Transaction.source_id.in_(cc_ids),
            Transaction.deleted_at.is_(None),
        )
    ).all()
    for source_id, t_type, amount in all_rows:
        amount_idr = fx.convert_to_idr(Decimal(amount), curr_by_id.get(source_id, "IDR"), rates)
        if t_type == "income":
            outstanding -= amount_idr
        else:
            outstanding += amount_idr

    month_rows = db.execute(
        select(Transaction.source_id, Transaction.type, Transaction.amount).where(
            Transaction.source_id.in_(cc_ids),
            Transaction.deleted_at.is_(None),
            Transaction.occurred_at >= start,
            Transaction.occurred_at < end,
        )
    ).all()
    month_charges = Decimal("0")
    month_payments = Decimal("0")
    for source_id, t_type, amount in month_rows:
        amount_idr = fx.convert_to_idr(Decimal(amount), curr_by_id.get(source_id, "IDR"), rates)
        if t_type == "expense":
            month_charges += amount_idr
        else:
            month_payments += amount_idr

    return {
        # Keep sign: negative means debt still owed on credit cards.
        "outstanding": str(_idr_round(outstanding)),
        "month_charges": str(_idr_round(month_charges)),
        "month_payments": str(_idr_round(month_payments)),
    }


@router.get("/overview")
def overview(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    year: int | None = None,
    month: int | None = None,
):
    today = datetime.now(timezone.utc)
    y = year or today.year
    m = month or today.month
    start, end = _month_bounds(y, m)
    rates = fx.get_rates_cached(db)

    # days in month and day-of-month for pacing
    days_in_month = (end - start).days
    today_day = today.day if (today.year == y and today.month == m) else days_in_month

    # Per-category spent
    spent_by_cat = _category_spent(db, user.id, start, end, rates)
    cats = {c.id: c.name for c in db.query(Category).filter_by(user_id=user.id).all()}
    budgets = db.query(Budget).filter_by(user_id=user.id).all()
    budget_rows = []
    for b in budgets:
        limit = _idr_round(Decimal(b.monthly_limit))
        spent = spent_by_cat.get(b.category_id, Decimal("0"))
        remaining = _idr_round(limit - spent)
        pct = float(spent / limit) if limit else 0.0
        expected_pct = today_day / days_in_month
        if pct > 1:
            status_str = "over"
        elif pct > expected_pct + 0.1:
            status_str = "behind"
        elif pct < expected_pct - 0.1:
            status_str = "ahead"
        else:
            status_str = "on_track"
        budget_rows.append(
            {
                "category_id": b.category_id,
                "category_name": cats.get(b.category_id, ""),
                "limit": str(_idr_round(limit)),
                "spent": str(_idr_round(spent)),
                "remaining": str(remaining),
                "pct_used": pct,
                "status": status_str,
            }
        )

    # Totals this month (exclude internal transfers/credit payments, normalized to IDR)
    totals_rows = db.execute(
        select(Transaction.type, Transaction.amount, Source.currency)
        .join(Source, Source.id == Transaction.source_id)
        .where(
            Transaction.user_id == user.id,
            Transaction.deleted_at.is_(None),
            Transaction.is_internal.is_(False),
            Transaction.occurred_at >= start,
            Transaction.occurred_at < end,
        )
    ).all()

    month_income = Decimal("0")
    month_expense = Decimal("0")
    for t_type, amount, currency in totals_rows:
        amount_idr = fx.convert_to_idr(Decimal(amount), currency or "IDR", rates)
        if t_type == "income":
            month_income += amount_idr
        else:
            month_expense += amount_idr

    return {
        "year": y,
        "month": m,
        "days_in_month": days_in_month,
        "today_day": today_day,
        "totals": {
            "income": str(_idr_round(month_income)),
            "expense": str(_idr_round(month_expense)),
            "net": str(_idr_round(month_income - month_expense)),
        },
        "budgets": budget_rows,
        "credit": _credit_summary(db, user.id, start, end, rates),
    }


@router.get("/monthly")
def monthly(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    year: int = Query(default=None),
):
    if year is None:
        year = datetime.now(timezone.utc).year
    year_start = datetime(year, 1, 1, tzinfo=timezone.utc)
    year_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    rates = fx.get_rates_cached(db)

    rows = db.execute(
        select(Transaction.occurred_at, Transaction.type, Transaction.amount, Source.currency)
        .join(Source, Source.id == Transaction.source_id)
        .where(
            Transaction.user_id == user.id,
            Transaction.deleted_at.is_(None),
            Transaction.is_internal.is_(False),
            Transaction.occurred_at >= year_start,
            Transaction.occurred_at < year_end,
        )
    ).all()

    by_month: dict[int, dict[str, Decimal]] = {
        m: {"income": Decimal("0"), "expense": Decimal("0")} for m in range(1, 13)
    }
    for occurred_at, t_type, amount, currency in rows:
        m = int(occurred_at.month)
        amount_idr = fx.convert_to_idr(Decimal(amount), currency or "IDR", rates)
        by_month[m]["income" if t_type == "income" else "expense"] += amount_idr

    out = []
    for m in range(1, 13):
        inc = by_month[m]["income"]
        exp = by_month[m]["expense"]
        out.append(
            {
                "month": m,
                "income": str(_idr_round(inc)),
                "expense": str(_idr_round(exp)),
                "net": str(_idr_round(inc - exp)),
            }
        )
    return {"year": year, "months": out}


@router.get("/daily")
def daily(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    year: int = Query(default=None),
    month: int = Query(default=None),
):
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month
    start, end = _month_bounds(y, m)
    days_in_month = (end - start).days
    rates = fx.get_rates_cached(db)

    rows = db.execute(
        select(Transaction.occurred_at, Transaction.type, Transaction.amount, Source.currency)
        .join(Source, Source.id == Transaction.source_id)
        .where(
            Transaction.user_id == user.id,
            Transaction.deleted_at.is_(None),
            Transaction.is_internal.is_(False),
            Transaction.occurred_at >= start,
            Transaction.occurred_at < end,
        )
    ).all()

    by_day: dict[int, dict[str, Decimal]] = {
        d: {"income": Decimal("0"), "expense": Decimal("0")} for d in range(1, days_in_month + 1)
    }
    for occurred_at, t_type, amount, currency in rows:
        d = int(occurred_at.day)
        amount_idr = fx.convert_to_idr(Decimal(amount), currency or "IDR", rates)
        by_day[d]["income" if t_type == "income" else "expense"] += amount_idr

    out = []
    for d in range(1, days_in_month + 1):
        inc = by_day[d]["income"]
        exp = by_day[d]["expense"]
        out.append({"day": d, "income": str(_idr_round(inc)), "expense": str(_idr_round(exp))})
    return {"year": y, "month": m, "days": out}


@router.get("/categories")
def categories_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
):
    now = datetime.now(timezone.utc)
    start_dt = (
        datetime.combine(from_, datetime.min.time(), tzinfo=timezone.utc)
        if from_
        else datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    )
    end_dt = (
        datetime.combine(to, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
        if to
        else start_dt + timedelta(days=32)
    )
    rates = fx.get_rates_cached(db)

    rows = db.execute(
        select(
            Transaction.category_id,
            Transaction.type,
            Transaction.amount,
            Source.currency,
        )
        .join(Source, Source.id == Transaction.source_id)
        .where(
            Transaction.user_id == user.id,
            Transaction.deleted_at.is_(None),
            Transaction.is_internal.is_(False),
            Transaction.occurred_at >= start_dt,
            Transaction.occurred_at < end_dt,
        )
    ).all()
    cat_names = {c.id: c.name for c in db.query(Category).filter_by(user_id=user.id).all()}
    agg: dict[int, dict[str, Decimal | int]] = {}
    for category_id, t_type, amount, currency in rows:
        if category_id not in agg:
            agg[category_id] = {
                "income": Decimal("0"),
                "expense": Decimal("0"),
                "n": 0,
            }
        amount_idr = fx.convert_to_idr(Decimal(amount), currency or "IDR", rates)
        if t_type == "income":
            agg[category_id]["income"] = Decimal(agg[category_id]["income"]) + amount_idr
        else:
            agg[category_id]["expense"] = Decimal(agg[category_id]["expense"]) + amount_idr
        agg[category_id]["n"] = int(agg[category_id]["n"]) + 1

    out = []
    for category_id, row in agg.items():
        out.append(
            {
                "category_id": category_id,
                "category_name": cat_names.get(category_id, ""),
                "income": str(_idr_round(Decimal(row["income"]))),
                "expense": str(_idr_round(Decimal(row["expense"]))),
                "transactions": row["n"],
            }
        )
    out.sort(key=lambda x: Decimal(x["expense"]), reverse=True)
    return {
        "from": start_dt.date().isoformat(),
        "to": (end_dt - timedelta(days=1)).date().isoformat(),
        "categories": out,
    }
