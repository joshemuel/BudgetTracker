from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import Budget, Category, Source, Transaction, User
from app.services import fx

router = APIRouter(prefix="/stats", tags=["stats"])

SUPPORTED_CURRENCIES = {"IDR", "SGD", "JPY", "AUD", "TWD"}


def _round_currency(v: Decimal, currency: str) -> Decimal:
    if currency in {"IDR", "JPY"}:
        return v.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _report_currency(user: User, currency: str | None) -> str:
    cur = (currency or user.default_currency or "IDR").upper()
    if cur not in SUPPORTED_CURRENCIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported currency")
    return cur


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


def _category_spent(
    db: Session,
    user_id: int,
    start: datetime,
    end: datetime,
    rates: fx.FxRates,
    report_currency: str,
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
        out[category_id] = out.get(category_id, Decimal("0")) + fx.convert(
            Decimal(amount), currency or "IDR", report_currency, rates
        )
    return out


def _credit_summary(
    db: Session,
    user_id: int,
    start: datetime,
    end: datetime,
    rates: fx.FxRates,
    report_currency: str,
) -> dict:
    cc_sources = db.query(Source).filter_by(user_id=user_id, is_credit_card=True).all()
    if not cc_sources:
        return {
            "outstanding": "0",
            "month_charges": "0",
            "month_payments": "0",
        }
    cc_ids = [s.id for s in cc_sources]
    curr_by_id = {s.id: s.currency or "IDR" for s in cc_sources}

    outstanding = Decimal("0")
    for s in cc_sources:
        outstanding += fx.convert(
            Decimal(s.starting_balance),
            s.currency or "IDR",
            report_currency,
            rates,
        )

    all_rows = db.execute(
        select(Transaction.source_id, Transaction.type, Transaction.amount).where(
            Transaction.source_id.in_(cc_ids),
            Transaction.deleted_at.is_(None),
        )
    ).all()
    for source_id, t_type, amount in all_rows:
        amount_report = fx.convert(
            Decimal(amount),
            curr_by_id.get(source_id, "IDR"),
            report_currency,
            rates,
        )
        if t_type == "income":
            outstanding += amount_report
        else:
            outstanding -= amount_report

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
        amount_report = fx.convert(
            Decimal(amount),
            curr_by_id.get(source_id, "IDR"),
            report_currency,
            rates,
        )
        if t_type == "expense":
            month_charges += amount_report
        else:
            month_payments += amount_report

    return {
        # Negative means debt still owed, 0 means clear.
        "outstanding": str(
            _round_currency(outstanding, report_currency) if outstanding < 0 else Decimal("0")
        ),
        "month_charges": str(_round_currency(month_charges, report_currency)),
        "month_payments": str(_round_currency(month_payments, report_currency)),
    }


@router.get("/overview")
def overview(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    year: int | None = None,
    month: int | None = None,
    currency: str | None = Query(default=None),
):
    today = datetime.now(timezone.utc)
    y = year or today.year
    m = month or today.month
    report_currency = _report_currency(user, currency)
    start, end = _month_bounds(y, m)
    rates = fx.get_rates_cached(db)

    # days in month and day-of-month for pacing
    days_in_month = (end - start).days
    today_day = today.day if (today.year == y and today.month == m) else days_in_month

    # Per-category spent in selected reporting currency
    spent_by_cat = _category_spent(db, user.id, start, end, rates, report_currency)
    cats = {c.id: c.name for c in db.query(Category).filter_by(user_id=user.id).all()}
    budgets = db.query(Budget).filter_by(user_id=user.id).all()
    budget_rows = []
    for b in budgets:
        limit = fx.convert(Decimal(b.monthly_limit), b.currency, report_currency, rates)
        limit = _round_currency(limit, report_currency)
        spent = spent_by_cat.get(b.category_id, Decimal("0"))
        remaining = _round_currency(limit - spent, report_currency)
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
                "limit": str(_round_currency(limit, report_currency)),
                "spent": str(_round_currency(spent, report_currency)),
                "remaining": str(remaining),
                "pct_used": pct,
                "status": status_str,
            }
        )

    # Totals this month (exclude internal transfers/credit payments) in report currency
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
        amount_report = fx.convert(Decimal(amount), currency or "IDR", report_currency, rates)
        if t_type == "income":
            month_income += amount_report
        else:
            month_expense += amount_report

    return {
        "year": y,
        "month": m,
        "currency": report_currency,
        "days_in_month": days_in_month,
        "today_day": today_day,
        "totals": {
            "income": str(_round_currency(month_income, report_currency)),
            "expense": str(_round_currency(month_expense, report_currency)),
            "net": str(_round_currency(month_income - month_expense, report_currency)),
        },
        "budgets": budget_rows,
        "credit": _credit_summary(db, user.id, start, end, rates, report_currency),
    }


@router.get("/monthly")
def monthly(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    year: int = Query(default=None),
    currency: str | None = Query(default=None),
):
    if year is None:
        year = datetime.now(timezone.utc).year
    report_currency = _report_currency(user, currency)
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
        amount_report = fx.convert(Decimal(amount), currency or "IDR", report_currency, rates)
        by_month[m]["income" if t_type == "income" else "expense"] += amount_report

    out = []
    for m in range(1, 13):
        inc = by_month[m]["income"]
        exp = by_month[m]["expense"]
        out.append(
            {
                "month": m,
                "income": str(_round_currency(inc, report_currency)),
                "expense": str(_round_currency(exp, report_currency)),
                "net": str(_round_currency(inc - exp, report_currency)),
            }
        )
    return {"year": year, "currency": report_currency, "months": out}


@router.get("/daily")
def daily(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    year: int = Query(default=None),
    month: int = Query(default=None),
    currency: str | None = Query(default=None),
):
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month
    report_currency = _report_currency(user, currency)
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
        amount_report = fx.convert(Decimal(amount), currency or "IDR", report_currency, rates)
        by_day[d]["income" if t_type == "income" else "expense"] += amount_report

    out = []
    for d in range(1, days_in_month + 1):
        inc = by_day[d]["income"]
        exp = by_day[d]["expense"]
        out.append(
            {
                "day": d,
                "income": str(_round_currency(inc, report_currency)),
                "expense": str(_round_currency(exp, report_currency)),
            }
        )
    return {"year": y, "month": m, "currency": report_currency, "days": out}


@router.get("/categories")
def categories_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    currency: str | None = Query(default=None),
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
    report_currency = _report_currency(user, currency)
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
    for category_id, t_type, amount, source_currency in rows:
        if category_id not in agg:
            agg[category_id] = {
                "income": Decimal("0"),
                "expense": Decimal("0"),
                "n": 0,
            }
        amount_report = fx.convert(
            Decimal(amount), source_currency or "IDR", report_currency, rates
        )
        if t_type == "income":
            agg[category_id]["income"] = Decimal(agg[category_id]["income"]) + amount_report
        else:
            agg[category_id]["expense"] = Decimal(agg[category_id]["expense"]) + amount_report
        agg[category_id]["n"] = int(agg[category_id]["n"]) + 1

    out = []
    for category_id, row in agg.items():
        out.append(
            {
                "category_id": category_id,
                "category_name": cat_names.get(category_id, ""),
                "income": str(_round_currency(Decimal(row["income"]), report_currency)),
                "expense": str(_round_currency(Decimal(row["expense"]), report_currency)),
                "transactions": row["n"],
            }
        )
    out.sort(key=lambda x: Decimal(x["expense"]), reverse=True)
    return {
        "from": start_dt.date().isoformat(),
        "to": (end_dt - timedelta(days=1)).date().isoformat(),
        "currency": report_currency,
        "categories": out,
    }


@router.get("/sync")
def sync_state(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    token = db.execute(
        select(func.coalesce(func.max(Transaction.id), 0)).where(Transaction.user_id == user.id)
    ).scalar_one()
    return {"token": int(token or 0)}
