from datetime import datetime, timezone
from decimal import Decimal

from app.services.parse import (
    correct_inflated_decimal_amounts,
    ensure_date,
    extract_decimal_literals,
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


def test_parse_amount_keeps_short_decimals_literal():
    # The bug: "8.50" must stay 8.50, never 850 or 8500.
    assert parse_amount("8.50") == Decimal("8.50")
    assert parse_amount("8,50") == Decimal("8.50")
    assert parse_amount("0.5") == Decimal("0.5")
    assert parse_amount("12.75") == Decimal("12.75")


def test_extract_decimal_literals_finds_short_decimals():
    assert extract_decimal_literals("I spent 8.50 on food") == [Decimal("8.50")]
    assert extract_decimal_literals("Spent 8,50 on coffee") == [Decimal("8.50")]
    assert extract_decimal_literals("8.50 lunch and 5.25 dinner") == [
        Decimal("8.50"),
        Decimal("5.25"),
    ]


def test_extract_decimal_literals_skips_indonesian_thousands():
    # 21.900 (3-digit grouping) is a thousand separator, not a decimal.
    assert extract_decimal_literals("Rp 21.900 for groceries") == []
    # "1.5jt" / "3.8k" are shorthand suffixes, not bare decimals.
    assert extract_decimal_literals("paid 1.5jt rent") == []
    assert extract_decimal_literals("3.8k coffee") == []


def test_extract_decimal_literals_ignores_dates_and_times():
    assert extract_decimal_literals("logged on 11/03/2026 at 12:30:45") == []


def test_correct_inflated_decimal_amounts_overrides_llm_scale():
    items = [{"amount": 8500}]
    correct_inflated_decimal_amounts(items, "I spent 8.50 on food")
    assert items[0]["amount"] == Decimal("8.50")


def test_correct_inflated_decimal_amounts_handles_comma_decimal():
    items = [{"amount": 850}]
    correct_inflated_decimal_amounts(items, "Spent 8,50 on coffee")
    assert items[0]["amount"] == Decimal("8.50")


def test_correct_inflated_decimal_amounts_leaves_correct_amounts():
    # LLM already returned the literal — don't touch.
    items = [{"amount": "8.50"}]
    correct_inflated_decimal_amounts(items, "8.50 coffee")
    assert items[0]["amount"] == "8.50"


def test_correct_inflated_decimal_amounts_consumes_each_literal_once():
    items = [{"amount": 8500}, {"amount": 5000}]
    correct_inflated_decimal_amounts(items, "spent 8.50 on coffee and 5k on bus")
    assert items[0]["amount"] == Decimal("8.50")
    # 5k is unrelated to the literal — must be left alone.
    assert items[1]["amount"] == 5000


def test_correct_inflated_decimal_amounts_noop_without_literals():
    items = [{"amount": 40000}]
    correct_inflated_decimal_amounts(items, "spent 40k on food")
    assert items[0]["amount"] == 40000


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
