from datetime import datetime, timezone
from decimal import Decimal

from app.services.parse import (
    ensure_date,
    format_number,
    parse_amount,
    resolve_occurred_at,
    resolve_source_name,
    tz,
)


def test_parse_amount_basic():
    assert parse_amount("40k") == Decimal("40000")
    assert parse_amount("1.5jt") == Decimal("1500000")
    assert parse_amount("2jt") == Decimal("2000000")
    assert parse_amount("Rp. 21.900") == Decimal("21900")
    assert parse_amount("150000") == Decimal("150000")
    assert parse_amount(None) == Decimal("0")
    assert parse_amount("") == Decimal("0")
    assert parse_amount("500rb") == Decimal("500000")
    assert parse_amount("2 juta") == Decimal("2000000")


def test_format_number():
    assert format_number(1500000) == "1.500.000"
    assert format_number(0) == "0"
    assert format_number(Decimal("45000")) == "45.000"


def test_ensure_date_accepts_dmy():
    fallback = datetime(2026, 4, 17, tzinfo=timezone.utc)
    assert ensure_date("11/03/2026", fallback).isoformat() == "2026-03-11"
    assert ensure_date(None, fallback).isoformat() == "2026-04-17"
    assert ensure_date("not-a-date", fallback).isoformat() == "2026-04-17"


def test_resolve_source_exact_and_fuzzy():
    valid = ["BCA", "BCA Credit Card", "GoPay"]
    assert resolve_source_name("GoPay", valid, "BCA") == "GoPay"
    assert resolve_source_name("gopay", valid, "BCA") == "GoPay"
    assert resolve_source_name("credit", valid, "BCA") == "BCA Credit Card"
    assert resolve_source_name(None, valid, "BCA") == "BCA"
    assert resolve_source_name("unknown", valid, "BCA") == "BCA"


def test_resolve_occurred_at_today_uses_now():
    now = datetime.now(tz())
    dt = resolve_occurred_at(None, None, now)
    assert dt.date() == now.date()
    assert dt.tzinfo is not None


def test_resolve_occurred_at_past_day_defaults_to_noon():
    now = datetime.now(tz())
    dt = resolve_occurred_at("01/01/2020", None, now)
    assert dt.isoformat().endswith("12:00:00+07:00") or dt.hour == 12
