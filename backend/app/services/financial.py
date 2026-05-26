"""Port of processFinancialMessage — takes parsed transaction items and writes
them to the DB, returns confirmations + budget notes in Leo's voice."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Budget, Category, Source, Transaction, User
from app.services import fx, fx_historical
from app.services.parse import (
    ensure_date,
    format_number,
    now_local,
    resolve_occurred_at,
    resolve_source_name,
    tz,
)
from app.services.currency_mode import default_source_for_currency, resolve_entry_currency

log = logging.getLogger(__name__)

DEFAULT_SOURCE = "BCA"
TRANSFER_TOP_UP = "Top-up"
TRANSFER_INVESTMENT = "Investment"
SAVINGS_HINTS = {
    "saving",
    "savings",
    "tabungan",
    "invest",
    "investment",
    "reksadana",
    "deposit",
    "broker",
    "emergency",
}


@dataclass
class TxSummary:
    tx_id: int
    t_type: str  # "expense" or "income"
    amount: Decimal
    category: str
    source: str
    currency: str
    date: str
    description: str | None
    fx_rate: Decimal | None = None
    fx_from_currency: str | None = None


@dataclass
class LogOutcome:
    summaries: list[TxSummary]
    budget_notes: list[str]

    @property
    def transaction_ids(self) -> list[int]:
        return [s.tx_id for s in self.summaries]

    def as_message(self) -> str:
        if not self.summaries:
            return "Got the message, but couldn't extract any amounts. Try again?"

        def _fmt(s: TxSummary) -> str:
            prefix = "Rp " if s.currency.upper() == "IDR" else f"{s.currency.upper()} "
            lines = [
                f"Type: {'Expense' if s.t_type == 'expense' else 'Income'}",
                f"Amount: {prefix}{format_number(s.amount)}",
                f"Category: {s.category}",
                f"Source: {s.source}",
                f"Date: {s.date}",
            ]
            if s.description:
                lines.append(f"Note: {s.description}")
            if s.fx_rate is not None and s.fx_from_currency:
                lines.append(
                    f"FX: 1 {s.fx_from_currency.upper()} ≈ "
                    f"{s.fx_rate.normalize():f} {s.currency.upper()}"
                )
            return "\n".join(lines)

        parts: list[str] = []
        if len(self.summaries) == 1:
            parts.append("Logged\n")
            parts.append(_fmt(self.summaries[0]))
        else:
            parts.append(f"Logged {len(self.summaries)} transactions\n")
            for i, s in enumerate(self.summaries, 1):
                parts.append(f"#{i}\n{_fmt(s)}")

        if self.budget_notes:
            parts.append("\n".join(self.budget_notes))

        return "\n\n".join(parts)


def _month_bounds_for(occurred_at: datetime) -> tuple[datetime, datetime]:
    local = occurred_at.astimezone(tz()) if occurred_at.tzinfo else occurred_at.replace(tzinfo=tz())
    start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


def _status_day_for(month_start: datetime, next_month: datetime) -> int:
    now = now_local()
    if now.year == month_start.year and now.month == month_start.month:
        return now.day
    return (next_month - month_start).days


def _monthly_status(
    db: Session, user_id: int, category_id: int, occurred_at: datetime
) -> tuple[Decimal, Decimal, str] | None:
    b = db.query(Budget).filter_by(user_id=user_id, category_id=category_id).one_or_none()
    if b is None:
        return None

    cat = db.get(Category, category_id)
    if cat is not None and cat.name.strip().lower() in {"untrackable", "untracked"}:
        return None

    month_start, next_month = _month_bounds_for(occurred_at)
    rows = db.execute(
        select(Transaction.amount, Transaction.currency)
        .where(
            Transaction.user_id == user_id,
            Transaction.deleted_at.is_(None),
            Transaction.type == "expense",
            Transaction.is_internal.is_(False),
            Transaction.category_id == category_id,
            Transaction.occurred_at >= month_start,
            Transaction.occurred_at < next_month,
        )
    ).all()

    budget_currency = (b.currency or "IDR").upper()
    rates = (
        fx.get_cached_rates_or_fallback(db)
        if any((c or "IDR").upper() != budget_currency for _, c in rows)
        else None
    )
    spent = Decimal("0")
    for amount, source_currency in rows:
        amount_dec = Decimal(amount)
        source_cur = (source_currency or "IDR").upper()
        if source_cur == budget_currency or rates is None:
            spent += amount_dec
        else:
            spent += fx.convert(amount_dec, source_cur, budget_currency, rates)

    limit = Decimal(b.monthly_limit)
    if limit == 0:
        return spent, limit, "On Track"

    days_in_month = (next_month - month_start).days
    pct = float(spent / limit) * 100
    expected = (_status_day_for(month_start, next_month) / days_in_month) * 100
    if pct > 100:
        status = "Over"
    elif pct > expected + 10:
        status = "Behind"
    elif pct < expected - 10:
        status = "Ahead"
    else:
        status = "On Track"
    return spent, limit, status


def _norm_tokens(text: str) -> list[str]:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip().split()


def _base_token(token: str) -> str:
    if token.endswith("ies") and len(token) > 3:
        return token[:-3] + "y"
    if token.endswith("s") and len(token) > 3:
        return token[:-1]
    return token


def _resolve_category_name(parsed: str | None, valid: list[str], default: str) -> str:
    if not parsed:
        return default

    p = " ".join(_norm_tokens(str(parsed)))
    if not p:
        return default
    p_base = " ".join(_base_token(t) for t in p.split())

    normalized: list[tuple[str, str, str]] = []
    for v in valid:
        n = " ".join(_norm_tokens(v))
        n_base = " ".join(_base_token(t) for t in n.split())
        normalized.append((v, n, n_base))

    for v, n, n_base in normalized:
        if n == p or n_base == p_base:
            return v

    for v, n, n_base in normalized:
        if p in n or n in p or p_base in n_base or n_base in p_base:
            return v

    return default


def _looks_like_transfer(description: str | None, is_internal: bool) -> bool:
    if is_internal:
        return True
    d = str(description or "").strip().lower()
    return d.startswith("transfer to ") or d.startswith("transfer from ")


def _is_savings_like(label: str | None) -> bool:
    if not label:
        return False
    tokens = set(_norm_tokens(str(label)))
    return any(t in SAVINGS_HINTS for t in tokens)


def _transfer_category_for_item(
    t_type: str,
    source_name: str,
    description: str | None,
) -> str:
    d = str(description or "").strip().lower()
    if d.startswith("transfer to "):
        target = d[len("transfer to ") :].strip()
        if _is_savings_like(target):
            return TRANSFER_INVESTMENT
        return TRANSFER_TOP_UP

    if d.startswith("transfer from "):
        if _is_savings_like(source_name):
            return TRANSFER_INVESTMENT
        return TRANSFER_TOP_UP

    if t_type == "income" and _is_savings_like(source_name):
        return TRANSFER_INVESTMENT

    if _is_savings_like(source_name):
        return TRANSFER_INVESTMENT
    return TRANSFER_TOP_UP


def log_items(db: Session, user: User, items: list[dict[str, Any]]) -> LogOutcome:
    """Apply a batch of parsed transactions. Items shape:
      { type: "Income"|"Expense"|"expense"|"income",
        category: str,
        amount: int/str,
        source: str|None,
        description: str|None,
        date: "MM/DD/yyyy"|None,
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
    valid_cat_names = [c.name for c in categories]

    def _category_by_name(name: str) -> Category:
        key = name.strip().lower()
        existing = cat_by_name.get(key)
        if existing is not None:
            return existing
        created = Category(user_id=user.id, name=name.strip(), is_default=False)
        db.add(created)
        db.flush()
        cat_by_name[key] = created
        valid_cat_names.append(created.name)
        return created

    other_cat = cat_by_name.get("other") or categories[0]

    sources = db.query(Source).filter_by(user_id=user.id, active=True).all()
    src_by_name: dict[str, Source] = {s.name.lower(): s for s in sources}
    valid_names = [s.name for s in sources]
    preferred_src = default_source_for_currency(db, user, user.default_currency or "IDR")
    if preferred_src is None and user.default_expense_source_id is not None:
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
    if default_src is None and user.sources_enabled:
        raise RuntimeError("User has no sources defined")

    now = now_local()
    budget_notes: list[str] = []
    created: list[Transaction] = []
    _summary_data: list[dict] = []

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
        resolved_cat_name = _resolve_category_name(cat_name, valid_cat_names, other_cat.name)
        category = cat_by_name.get(resolved_cat_name.lower(), other_cat)

        raw_src = item.get("source")
        if user.sources_enabled:
            if default_src is None:
                raise RuntimeError("User has no sources defined")
            fallback_name = default_src.name
            resolved_name = resolve_source_name(raw_src, valid_names, fallback_name)
            source = src_by_name.get(resolved_name.lower(), default_src)
            currency = resolve_entry_currency(
                sources_enabled=True,
                explicit_currency=item.get("currency"),
                source_currency=source.currency,
                default_currency=user.default_currency,
            )
            source_name = source.name
        else:
            currency = resolve_entry_currency(
                sources_enabled=False,
                explicit_currency=item.get("currency"),
                source_currency=None,
                default_currency=user.default_currency,
            )
            source = default_source_for_currency(db, user, currency)
            if source is None:
                raise RuntimeError(f"User has no default source for {currency}")
            source_name = "N/A"

        occurred = resolve_occurred_at(item.get("date"), item.get("time"), now)
        date_str = ensure_date(item.get("date"), now).strftime("%m/%d/%Y")

        description = item.get("description")
        if description is not None:
            description = str(description).strip() or None

        is_internal = item.get("is_internal", False) is True
        if _looks_like_transfer(description, is_internal):
            transfer_category_name = _transfer_category_for_item(t_type, source.name, description)
            category = _category_by_name(transfer_category_name)
            is_internal = True

        tx = Transaction(
            user_id=user.id,
            occurred_at=occurred,
            type=t_type,
            category_id=category.id,
            amount=amount,
            source_id=source.id,
            currency=currency,
            description=description,
            is_internal=is_internal,
        )
        db.add(tx)
        created.append(tx)
        _summary_data.append(
            dict(
                t_type=t_type,
                amount=amount,
                category=category.name,
                source=source_name,
                currency=currency,
                date=date_str,
                description=description,
            )
        )

        if t_type == "expense":
            db.flush()
            ms = None if is_internal else _monthly_status(db, user.id, category.id, occurred)
            if ms is not None:
                spent, limit, status = ms
                if limit > 0:
                    pct = int(round(float(spent / limit) * 100))
                    budget_notes.append(
                        f"Budget — {category.name}: {format_number(spent)} / "
                        f"{format_number(limit)} ({pct}%) — {status}"
                    )

    # Transfer pair detection (also applies historical FX for cross-currency pairs)
    src_by_id = {s.id: s for s in sources}
    _link_transfers(db, created, _summary_data, src_by_id)

    db.commit()
    for tx in created:
        db.refresh(tx)

    summaries = [
        TxSummary(tx_id=tx.id, **data)
        for tx, data in zip(created, _summary_data)
    ]

    return LogOutcome(summaries=summaries, budget_notes=budget_notes)


_TRANSFER_TO_RE = re.compile(r"^transfer\s+to\s+(.+)$", re.IGNORECASE)
_TRANSFER_FROM_RE = re.compile(r"^transfer\s+from\s+(.+)$", re.IGNORECASE)


def _transfer_target(desc: str | None) -> str | None:
    if not desc:
        return None
    m = _TRANSFER_TO_RE.match(desc.strip())
    return m.group(1).strip().lower() if m else None


def _transfer_source(desc: str | None) -> str | None:
    if not desc:
        return None
    m = _TRANSFER_FROM_RE.match(desc.strip())
    return m.group(1).strip().lower() if m else None


def _name_matches(a: str, b: str) -> bool:
    a = (a or "").strip().lower()
    b = (b or "").strip().lower()
    if not a or not b:
        return False
    return a == b or a in b or b in a


def _link_transfers(
    db: Session,
    created: list[Transaction],
    summary_data: list[dict],
    src_by_id: dict[int, Source],
) -> None:
    # Index created transactions with their summary slot for amount/currency mutation.
    indexed = list(enumerate(created))

    def _is_transfer(t: Transaction) -> bool:
        d = (t.description or "").strip().lower()
        return d.startswith("transfer to ") or d.startswith("transfer from ")

    expenses = [t for _, t in indexed if t.type == "expense" and _is_transfer(t)]
    incomes = [
        (i, t) for i, t in indexed
        if t.type == "income" and _is_transfer(t)
    ]

    used_incomes: set[int] = set()
    for exp in expenses:
        exp_src = src_by_id.get(exp.source_id)
        if exp_src is None:
            continue
        target_name = _transfer_target(exp.description)
        if target_name is None:
            continue
        for inc_i, inc in incomes:
            if inc_i in used_incomes:
                continue
            if inc.occurred_at.date() != exp.occurred_at.date():
                continue
            inc_src = src_by_id.get(inc.source_id)
            if inc_src is None:
                continue
            # income's source should match expense's "Transfer to <X>"
            if not _name_matches(inc_src.name, target_name):
                continue
            # if income carries "Transfer from <Y>", Y should match expense source
            from_name = _transfer_source(inc.description)
            if from_name is not None and not _name_matches(exp_src.name, from_name):
                continue

            gid = uuid4()
            exp.transfer_group_id = gid
            inc.transfer_group_id = gid
            exp.is_internal = True
            inc.is_internal = True

            # Cross-currency: convert the income leg using the rate for the
            # expense's occurred date. Same-currency: leave amounts alone.
            exp_ccy = (exp_src.currency or "IDR").upper()
            inc_ccy = (inc_src.currency or "IDR").upper()
            if exp_ccy != inc_ccy:
                try:
                    new_amount, rate = fx_historical.convert(
                        db,
                        exp.amount,
                        exp.occurred_at.date(),
                        exp_ccy,
                        inc_ccy,
                    )
                except Exception as e:
                    log.warning("FX conversion failed for transfer pair: %s", e)
                    rate = None
                    new_amount = inc.amount
                if rate is not None:
                    inc.amount = new_amount
                    inc.fx_rate = rate
                    summary_data[inc_i]["amount"] = new_amount
                    summary_data[inc_i]["fx_rate"] = rate
                    summary_data[inc_i]["fx_from_currency"] = exp_ccy

            used_incomes.add(inc_i)
            break


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
