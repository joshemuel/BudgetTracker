from __future__ import annotations

import re
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from app.config import get_settings


def tz() -> ZoneInfo:
    return ZoneInfo(get_settings().tz)


def now_local() -> datetime:
    return datetime.now(tz())


def _looks_grouped_thousands(value: str, sep: str) -> bool:
    parts = value.split(sep)
    if len(parts) < 2:
        return False
    if not parts[0] or any(not p for p in parts[1:]):
        return False
    return all(len(p) == 3 for p in parts[1:])


def _normalize_numeric_text(value: str, assume_thousands: bool) -> str:
    s = value
    if "." in s and "," in s:
        if s.rfind(".") > s.rfind(","):
            decimal_mark, thousands_mark = ".", ","
        else:
            decimal_mark, thousands_mark = ",", "."
        s = s.replace(thousands_mark, "")
        return s.replace(decimal_mark, ".")

    if "," in s:
        if assume_thousands or (s.count(",") > 1 and _looks_grouped_thousands(s, ",")):
            return s.replace(",", "")
        return s.replace(",", ".")

    if "." in s:
        if assume_thousands or (s.count(".") > 1 and _looks_grouped_thousands(s, ".")):
            return s.replace(".", "")
        return s

    return s


def parse_amount(text: str | None) -> Decimal:
    """Parse user-entered amount text into Decimal.

    Supported examples:
    - 40k -> 40000
    - 1.5jt / 2 juta -> 1500000 / 2000000
    - Rp. 21.900 -> 21900
    - 8.50 / 8,50 -> 8.50
    """
    if text is None:
        return Decimal("0")

    s = str(text).strip().lower()
    if not s:
        return Decimal("0")

    has_rp_prefix = re.match(r"^rp\.?\s*", s) is not None
    s = re.sub(r"^rp\.?\s*", "", s)
    s = re.sub(r"\s+", "", s)

    sign = Decimal("-1") if s.startswith("-") else Decimal("1")
    s = s.lstrip("+-")

    multiplier = Decimal("1")
    for pat, m in (
        (r"juta$", Decimal("1000000")),
        (r"jt$", Decimal("1000000")),
        (r"ribu$", Decimal("1000")),
        (r"rb$", Decimal("1000")),
        (r"k$", Decimal("1000")),
        (r"m$", Decimal("1000000")),
    ):
        if re.search(pat, s):
            multiplier = m
            s = re.sub(pat, "", s)
            break

    s = re.sub(r"[^0-9.,]", "", s)
    if not s or not re.search(r"\d", s):
        return Decimal("0")

    normalized = _normalize_numeric_text(s, assume_thousands=has_rp_prefix and multiplier == 1)
    if not normalized:
        return Decimal("0")

    try:
        base = Decimal(normalized)
    except Exception:
        return Decimal("0")

    return sign * base * multiplier


_DECIMAL_LITERAL_RE = re.compile(
    r"(?<![A-Za-z0-9_/:-])-?\d+[.,]\d{1,2}(?![.,]\d)(?![A-Za-z0-9_])"
)
_AMOUNT_SUFFIX_AFTER_RE = re.compile(r"^\s*(k|rb|ribu|jt|juta|m)\b", re.IGNORECASE)


def extract_decimal_literals(text: str | None) -> list[Decimal]:
    """Extract decimal-like literals from raw user text (e.g. 8.50 / 8,50).

    This is used as a safety net for chat parsing so punctuation-based decimals
    are preserved even if the LLM over-scales them.
    """
    if not text:
        return []

    out: list[Decimal] = []
    source = str(text)
    for match in _DECIMAL_LITERAL_RE.finditer(source):
        tail = source[match.end() :]
        if _AMOUNT_SUFFIX_AFTER_RE.match(tail):
            continue
        value = parse_amount(match.group(0))
        if value > 0:
            out.append(value)
    return out


_AMOUNT_SCALES = (Decimal("10"), Decimal("100"), Decimal("1000"))


def correct_inflated_decimal_amounts(
    items: list[dict[str, Any]], text: str | None
) -> None:
    """Override LLM-inflated amounts when the source text wrote a literal decimal.

    "I spent 8.50 on food" must log 8.50, not 8500. The LLM occasionally scales
    short decimals up despite the prompt; this is a deterministic safety net
    that runs against the raw user text. Each literal is consumed at most once,
    so two distinct literals fix two distinct items.
    """
    literals = extract_decimal_literals(text)
    if not literals or not items:
        return
    pool = list(literals)
    for item in items:
        if not pool:
            break
        raw = item.get("amount")
        if raw is None:
            continue
        try:
            amt = Decimal(str(raw))
        except Exception:
            continue
        for idx, lit in enumerate(pool):
            if amt == lit:
                pool.pop(idx)
                break
            if any(amt == lit * scale for scale in _AMOUNT_SCALES):
                item["amount"] = lit
                pool.pop(idx)
                break


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
    """Port of resolveTime — today with no time = now, other day = 12:00:00."""
    z = tz()
    d = parse_date_dmy(parsed_date) or now.astimezone(z).date()
    t = parse_time_hms(parsed_time)
    if t is None:
        if d == now.astimezone(z).date():
            t = now.astimezone(z).time().replace(microsecond=0)
        else:
            t = time(12, 0, 0)
    return datetime.combine(d, t, tzinfo=z)


def resolve_source_name(parsed: str | None, valid: list[str], default: str) -> str:
    if not parsed:
        return default

    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()

    p = _norm(str(parsed))
    if not p:
        return default

    normalized: list[tuple[str, str]] = [(v, _norm(v)) for v in valid]

    # Exact normalized match first.
    for v, n in normalized:
        if n == p:
            return v

    p_tokens = set(p.split())
    credit_hint = bool(p_tokens.intersection({"credit", "card", "cc", "kredit"}))
    scored: list[tuple[int, int, str]] = []

    for v, n in normalized:
        score = 0
        n_tokens = set(n.split())

        if p in n:
            score = max(score, 60)
        if n in p:
            score = max(score, 50)

        overlap = len(p_tokens.intersection(n_tokens))
        if overlap:
            score = max(score, overlap * 10)

        if credit_hint and n_tokens.intersection({"credit", "card", "cc", "kredit"}):
            score += 15

        if score > 0:
            scored.append((score, len(n), v))

    if scored:
        # Prefer stronger match, then more specific (longer) source name.
        scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
        return scored[0][2]

    return default
