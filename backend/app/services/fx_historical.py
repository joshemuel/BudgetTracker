from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

import httpx

from app.db.models import AppState
from app.services import fx

log = logging.getLogger(__name__)

STATE_KEY = "FX_HISTORICAL"

# Frankfurter (ECB-based) covers IDR, SGD, JPY, AUD, USD, EUR, GBP, etc.
# It does NOT cover TWD — for TWD pairs we fall back to fx.py cached rates.
FRANKFURTER_SUPPORTED = {"IDR", "SGD", "JPY", "AUD", "USD", "EUR", "GBP"}


def _cache_key(d: date, src: str, dst: str) -> str:
    return f"{d.isoformat()}|{src.upper()}|{dst.upper()}"


def _load_cache(db) -> tuple[AppState | None, dict[str, str]]:
    state = db.get(AppState, STATE_KEY)
    if state is None:
        return None, {}
    cache = state.value if isinstance(state.value, dict) else {}
    return state, dict(cache)


def _store_cache(db, state: AppState | None, cache: dict[str, str]) -> None:
    if state is None:
        state = AppState(key=STATE_KEY, value=cache)
        db.add(state)
    else:
        state.value = cache
    db.commit()


def _fetch_frankfurter(d: date, src: str, dst: str, timeout: float = 8.0) -> Decimal | None:
    url = f"https://api.frankfurter.app/{d.isoformat()}"
    params = {"from": src.upper(), "to": dst.upper()}
    with httpx.Client(timeout=timeout) as c:
        r = c.get(url, params=params)
        r.raise_for_status()
        body = r.json()
    rates = body.get("rates") or {}
    raw = rates.get(dst.upper())
    if raw is None:
        return None
    return Decimal(str(raw))


def get_rate(db, d: date, from_ccy: str, to_ccy: str) -> Decimal:
    """Return the rate to multiply a `from_ccy` amount by to get `to_ccy`.

    Caches per (date, from, to) in AppState. Falls back to fx.py cached
    today's rates when the date isn't covered (e.g. TWD pairs, network failure).
    Last-resort fallback is 1:1.
    """
    src = (from_ccy or "").upper()
    dst = (to_ccy or "").upper()
    if not src or not dst or src == dst:
        return Decimal("1")

    state, cache = _load_cache(db)
    key = _cache_key(d, src, dst)
    if key in cache:
        try:
            return Decimal(cache[key])
        except Exception:
            log.warning("Bad cached FX rate at %s; refetching", key)

    rate: Decimal | None = None
    if src in FRANKFURTER_SUPPORTED and dst in FRANKFURTER_SUPPORTED:
        try:
            rate = _fetch_frankfurter(d, src, dst)
        except Exception as e:
            log.warning("Frankfurter fetch failed for %s: %s", key, e)

    if rate is None:
        # Fall back to today's cached rates from fx.py. Compute the rate directly
        # (USD pivot) so we don't lose precision to fx.convert's 0.01 quantize.
        try:
            rates = fx.get_cached_rates_or_fallback(db)
            per_usd = rates.rates_per_usd
            if src in per_usd and dst in per_usd and per_usd[src] != 0:
                rate = (per_usd[dst] / per_usd[src])
            else:
                rate = Decimal("1")
        except Exception as e:
            log.warning("FX fallback failed for %s -> %s: %s", src, dst, e)
            rate = Decimal("1")

    rate = rate.quantize(Decimal("0.0000000001"), rounding=ROUND_HALF_UP)
    cache[key] = str(rate)
    _store_cache(db, state, cache)
    return rate


def convert(db, amount: Decimal, d: date, from_ccy: str, to_ccy: str) -> tuple[Decimal, Decimal]:
    """Convert an amount on a specific date. Returns (converted_amount, rate_used)."""
    rate = get_rate(db, d, from_ccy, to_ccy)
    out = (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return out, rate
