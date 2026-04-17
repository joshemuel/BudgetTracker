from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import Budget, Category, Source, Transaction, User

router = APIRouter(prefix="/stats", tags=["stats"])


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


def _category_spent(
    db: Session, user_id: int, start: datetime, end: datetime
) -> dict[int, Decimal]:
    stmt = (
        select(Transaction.category_id, func.sum(Transaction.amount))
        .where(
            Transaction.user_id == user_id,
            Transaction.deleted_at.is_(None),
            Transaction.type == "expense",
            Transaction.occurred_at >= start,
            Transaction.occurred_at < end,
        )
        .group_by(Transaction.category_id)
    )
    return {row[0]: (row[1] or Decimal("0")) for row in db.execute(stmt).all()}


def _credit_summary(db: Session, user_id: int, start: datetime, end: datetime) -> dict:
    cc_ids = [
        s.id
        for s in db.query(Source).filter_by(user_id=user_id, is_credit_card=True).all()
    ]
    if not cc_ids:
        return {"outstanding": "0", "month_charges": "0", "month_payments": "0"}
    # outstanding = starting + sum(income=payments) - sum(expense=charges) across all time
    starting = (
        db.query(func.coalesce(func.sum(Source.starting_balance), 0))
        .filter(Source.id.in_(cc_ids))
        .scalar()
    )
    income_all = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.source_id.in_(cc_ids),
            Transaction.type == "income",
            Transaction.deleted_at.is_(None),
        )
        .scalar()
    )
    expense_all = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.source_id.in_(cc_ids),
            Transaction.type == "expense",
            Transaction.deleted_at.is_(None),
        )
        .scalar()
    )
    outstanding = Decimal(starting) + Decimal(income_all) - Decimal(expense_all)
    # This month
    month_charges = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.source_id.in_(cc_ids),
            Transaction.type == "expense",
            Transaction.deleted_at.is_(None),
            Transaction.occurred_at >= start,
            Transaction.occurred_at < end,
        )
        .scalar()
    )
    month_payments = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.source_id.in_(cc_ids),
            Transaction.type == "income",
            Transaction.deleted_at.is_(None),
            Transaction.occurred_at >= start,
            Transaction.occurred_at < end,
        )
        .scalar()
    )
    return {
        "outstanding": str(outstanding),
        "month_charges": str(month_charges),
        "month_payments": str(month_payments),
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

    # days in month and day-of-month for pacing
    days_in_month = (end - start).days
    today_day = today.day if (today.year == y and today.month == m) else days_in_month

    # Per-category spent
    spent_by_cat = _category_spent(db, user.id, start, end)
    cats = {c.id: c.name for c in db.query(Category).filter_by(user_id=user.id).all()}
    budgets = db.query(Budget).filter_by(user_id=user.id).all()
    budget_rows = []
    for b in budgets:
        limit = b.monthly_limit
        spent = spent_by_cat.get(b.category_id, Decimal("0"))
        remaining = limit - spent
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
                "limit": str(limit),
                "spent": str(spent),
                "remaining": str(remaining),
                "pct_used": pct,
                "status": status_str,
            }
        )

    # Totals this month
    totals = db.execute(
        select(
            func.coalesce(
                func.sum(case((Transaction.type == "income", Transaction.amount), else_=0)),
                0,
            ),
            func.coalesce(
                func.sum(case((Transaction.type == "expense", Transaction.amount), else_=0)),
                0,
            ),
        ).where(
            Transaction.user_id == user.id,
            Transaction.deleted_at.is_(None),
            Transaction.occurred_at >= start,
            Transaction.occurred_at < end,
        )
    ).one()

    month_income = Decimal(totals[0])
    month_expense = Decimal(totals[1])

    return {
        "year": y,
        "month": m,
        "days_in_month": days_in_month,
        "today_day": today_day,
        "totals": {
            "income": str(month_income),
            "expense": str(month_expense),
            "net": str(month_income - month_expense),
        },
        "budgets": budget_rows,
        "credit": _credit_summary(db, user.id, start, end),
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

    # Aggregate by month (1-12)
    month_expr = func.extract("month", Transaction.occurred_at)
    rows = db.execute(
        select(
            month_expr.label("m"),
            func.coalesce(
                func.sum(case((Transaction.type == "income", Transaction.amount), else_=0)),
                0,
            ).label("income"),
            func.coalesce(
                func.sum(case((Transaction.type == "expense", Transaction.amount), else_=0)),
                0,
            ).label("expense"),
        )
        .where(
            Transaction.user_id == user.id,
            Transaction.deleted_at.is_(None),
            Transaction.occurred_at >= year_start,
            Transaction.occurred_at < year_end,
        )
        .group_by(month_expr)
        .order_by(month_expr)
    ).all()
    by_month = {int(r.m): r for r in rows}
    out = []
    for m in range(1, 13):
        r = by_month.get(m)
        inc = Decimal(r.income) if r else Decimal("0")
        exp = Decimal(r.expense) if r else Decimal("0")
        out.append(
            {
                "month": m,
                "income": str(inc),
                "expense": str(exp),
                "net": str(inc - exp),
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

    day_expr = func.extract("day", Transaction.occurred_at)
    rows = db.execute(
        select(
            day_expr.label("d"),
            func.coalesce(
                func.sum(case((Transaction.type == "income", Transaction.amount), else_=0)),
                0,
            ).label("income"),
            func.coalesce(
                func.sum(case((Transaction.type == "expense", Transaction.amount), else_=0)),
                0,
            ).label("expense"),
        )
        .where(
            Transaction.user_id == user.id,
            Transaction.deleted_at.is_(None),
            Transaction.occurred_at >= start,
            Transaction.occurred_at < end,
        )
        .group_by(day_expr)
        .order_by(day_expr)
    ).all()
    by_day = {int(r.d): r for r in rows}
    out = []
    for d in range(1, days_in_month + 1):
        r = by_day.get(d)
        inc = Decimal(r.income) if r else Decimal("0")
        exp = Decimal(r.expense) if r else Decimal("0")
        out.append({"day": d, "income": str(inc), "expense": str(exp)})
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

    rows = db.execute(
        select(
            Transaction.category_id,
            func.coalesce(
                func.sum(case((Transaction.type == "income", Transaction.amount), else_=0)),
                0,
            ).label("income"),
            func.coalesce(
                func.sum(case((Transaction.type == "expense", Transaction.amount), else_=0)),
                0,
            ).label("expense"),
            func.count(Transaction.id).label("n"),
        )
        .where(
            Transaction.user_id == user.id,
            Transaction.deleted_at.is_(None),
            Transaction.occurred_at >= start_dt,
            Transaction.occurred_at < end_dt,
        )
        .group_by(Transaction.category_id)
    ).all()
    cat_names = {c.id: c.name for c in db.query(Category).filter_by(user_id=user.id).all()}
    out = []
    for r in rows:
        out.append(
            {
                "category_id": r.category_id,
                "category_name": cat_names.get(r.category_id, ""),
                "income": str(r.income),
                "expense": str(r.expense),
                "transactions": r.n,
            }
        )
    out.sort(key=lambda x: Decimal(x["expense"]), reverse=True)
    return {
        "from": start_dt.date().isoformat(),
        "to": (end_dt - timedelta(days=1)).date().isoformat(),
        "categories": out,
    }
