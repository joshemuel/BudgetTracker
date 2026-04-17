from __future__ import annotations

import re
from datetime import date, datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.config import get_settings


def tz() -> ZoneInfo:
    return ZoneInfo(get_settings().tz)


def now_local() -> datetime:
    return datetime.now(tz())


def parse_amount(text: str | None) -> Decimal:
    """Handles 40k, 1.5jt, Rp. 21.900, 500rb."""
    if text is None:
        return Decimal("0")
    s = str(text).lower().strip()
    s = re.sub(r"^rp\.?\s*", "", s)
    s = re.sub(r"\s+", "", s)

    multiplier = 1
    for pat, m in (
        (r"juta$", 1_000_000),
        (r"jt$", 1_000_000),
        (r"ribu$", 1_000),
        (r"rb$", 1_000),
        (r"k$", 1_000),
    ):
        if re.search(pat, s):
            multiplier = m
            s = re.sub(pat, "", s)
            break

    # With a multiplier, a dot is a decimal ("1.5jt" → 1.5).
    # Without, dots are Indonesian thousand separators ("21.900" → 21900).
    if multiplier == 1:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")

    try:
        n = float(s)
    except ValueError:
        return Decimal("0")
    return Decimal(str(round(n * multiplier)))


def format_number(num: Decimal | int | float) -> str:
    """1500000 -> 1.500.000 (Indonesian period-separated)."""
    n = int(round(float(num)))
    return f"{n:,}".replace(",", ".")


_DATE_RE = re.compile(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$")


def parse_date_dmy(text: str | None) -> date | None:
    if not text:
        return None
    m = _DATE_RE.match(text.strip())
    if not m:
        return None
    d, mo, y = (int(x) for x in m.groups())
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def ensure_date(text: str | None, fallback: datetime) -> date:
    return parse_date_dmy(text) or fallback.astimezone(tz()).date()


def parse_time_hms(text: str | None) -> time | None:
    if not text:
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", text.strip())
    if not m:
        return None
    h, mi, se = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    try:
        return time(h, mi, se)
    except ValueError:
        return None


def resolve_occurred_at(
    parsed_date: str | None, parsed_time: str | None, now: datetime
) -> datetime:
    """Port of resolveTime — today with no time = now, other day = 00:00:00."""
    z = tz()
    d = parse_date_dmy(parsed_date) or now.astimezone(z).date()
    t = parse_time_hms(parsed_time)
    if t is None:
        if d == now.astimezone(z).date():
            t = now.astimezone(z).time().replace(microsecond=0)
        else:
            t = time(0, 0, 0)
    return datetime.combine(d, t, tzinfo=z)


def resolve_source_name(parsed: str | None, valid: list[str], default: str) -> str:
    if not parsed:
        return default
    p = str(parsed).strip().lower()
    for v in valid:
        if v.lower() == p:
            return v
    for v in valid:
        if v.lower() in p or p in v.lower():
            return v
    return default
