from datetime import date

from app.db.models import Subscription
from app.services.subscriptions import _safe_day, advance_next_billing


def test_safe_day_clamps_to_month_length():
    assert _safe_day(2026, 2, 30) == date(2026, 2, 28)
    assert _safe_day(2024, 2, 30) == date(2024, 2, 29)
    assert _safe_day(2026, 4, 31) == date(2026, 4, 30)
    assert _safe_day(2026, 1, 15) == date(2026, 1, 15)


def test_advance_monthly_rolls_year():
    sub = Subscription(
        user_id=0, name="X", amount=0, currency="IDR",
        source_id=0, category_id=0, billing_day=15,
        frequency="monthly", active=True,
        start_date=date(2026, 1, 1),
        next_billing_date=date(2026, 12, 15),
    )
    assert advance_next_billing(sub) == date(2027, 1, 15)


def test_advance_monthly_handles_short_months():
    sub = Subscription(
        user_id=0, name="X", amount=0, currency="IDR",
        source_id=0, category_id=0, billing_day=31,
        frequency="monthly", active=True,
        start_date=date(2026, 1, 1),
        next_billing_date=date(2026, 1, 31),
    )
    assert advance_next_billing(sub) == date(2026, 2, 28)


def test_advance_yearly():
    sub = Subscription(
        user_id=0, name="X", amount=0, currency="IDR",
        source_id=0, category_id=0, billing_day=29,
        frequency="yearly", active=True,
        start_date=date(2024, 2, 29),
        next_billing_date=date(2024, 2, 29),
    )
    # 2025 is not a leap year → clamps to Feb 28
    assert advance_next_billing(sub) == date(2025, 2, 28)
