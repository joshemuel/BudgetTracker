from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

import httpx
from sqlalchemy.orm import Session

from app.db.models import AppState
from app.db.session import SessionLocal

log = logging.getLogger(__name__)

SUPPORTED = {"IDR", "SGD", "JPY", "AUD", "TWD"}
STATE_KEY = "FX_RATES_USD"


@dataclass
class FxRates:
    rates_per_usd: dict[str, Decimal]
    fetched_at: datetime


def _to_decimal_map(raw: dict) -> dict[str, Decimal]:
    out: dict[str, Decimal] = {}
    for k in SUPPORTED:
        if k in raw:
            out[k] = Decimal(str(raw[k]))
    out["USD"] = Decimal("1")
    return out


def _fallback_rates() -> FxRates:
    one = Decimal("1")
    return FxRates(
        rates_per_usd={
            "USD": one,
            "IDR": one,
            "SGD": one,
            "JPY": one,
            "AUD": one,
            "TWD": one,
        },
        fetched_at=datetime.now(timezone.utc),
    )


def get_cached_rates(db) -> FxRates | None:
    state = db.get(AppState, STATE_KEY)
    if not state:
        return None
    try:
        ts = datetime.fromisoformat(state.value["fetched_at"])
        rates = _to_decimal_map(state.value["rates"])
        return FxRates(rates_per_usd=rates, fetched_at=ts)
    except Exception:
        log.warning("Invalid cached FX rates")
        return None


def get_cached_rates_or_fallback(db) -> FxRates:
    return get_cached_rates(db) or _fallback_rates()


def _fetch_latest_rates(timeout: float = 8.0) -> FxRates:
    # Free, no-key endpoint. Example response has rates where base=USD.
    url = "https://open.er-api.com/v6/latest/USD"
    with httpx.Client(timeout=timeout) as c:
        r = c.get(url)
        r.raise_for_status()
        body = r.json()
    rates = _to_decimal_map(body.get("rates") or {})
    if "IDR" not in rates:
        raise RuntimeError("FX API response missing IDR rate")
    return FxRates(rates_per_usd=rates, fetched_at=datetime.now(timezone.utc))


def get_rates_cached(db) -> FxRates:
    state = db.get(AppState, STATE_KEY)
    stale: FxRates | None = None
    cached = get_cached_rates(db)
    if cached is not None:
        stale = cached
        if datetime.now(timezone.utc) - cached.fetched_at < timedelta(hours=12):
            return cached

    try:
        fresh = _fetch_latest_rates()
    except Exception as e:
        log.warning("FX fetch failed: %s", e)
        if stale is not None:
            return stale
        # Last-resort fallback: no conversion (1:1) so API remains available.
        return _fallback_rates()

    payload = {
        "fetched_at": fresh.fetched_at.isoformat(),
        "rates": {k: str(v) for k, v in fresh.rates_per_usd.items()},
    }
    if state is None:
        state = AppState(key=STATE_KEY, value=payload)
        db.add(state)
    else:
        merged = dict(state.value.get("rates", {})) if isinstance(state.value, dict) else {}
        merged.update(payload["rates"])
        state.value = {
            "fetched_at": payload["fetched_at"],
            "rates": merged,
        }
    db.commit()
    return fresh


def refresh_rates(db: Session | None = None) -> bool:
    """Force-fetch the latest USD-based FX rates and cache them in AppState.

    Used by the daily scheduler job so conversions in budgets/overviews reflect
    once-daily prices instead of relying on lazy 12h on-demand fetches. Returns
    True when fresh rates were stored, False when the fetch failed (the existing
    cache is left untouched). Opens its own session when called without one
    (scheduler context)."""
    own_session = db is None
    if own_session:
        db = SessionLocal()
    try:
        try:
            fresh = _fetch_latest_rates()
        except Exception as e:
            log.warning("Daily FX refresh failed: %s", e)
            return False
        state = db.get(AppState, STATE_KEY)
        payload = {
            "fetched_at": fresh.fetched_at.isoformat(),
            "rates": {k: str(v) for k, v in fresh.rates_per_usd.items()},
        }
        if state is None:
            db.add(AppState(key=STATE_KEY, value=payload))
        else:
            merged = dict(state.value.get("rates", {})) if isinstance(state.value, dict) else {}
            merged.update(payload["rates"])
            state.value = {"fetched_at": payload["fetched_at"], "rates": merged}
        db.commit()
        log.info("FX rates refreshed (%s)", fresh.fetched_at.isoformat())
        return True
    finally:
        if own_session:
            db.close()


def convert_to_idr(amount: Decimal, source_currency: str, rates: FxRates) -> Decimal:
    source_currency = (source_currency or "IDR").upper()
    if source_currency == "IDR":
        return amount
    if source_currency not in rates.rates_per_usd:
        return amount
    # amount in SRC -> USD -> IDR
    usd = amount / rates.rates_per_usd[source_currency]
    idr = usd * rates.rates_per_usd["IDR"]
    return idr.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def convert(amount: Decimal, from_currency: str, to_currency: str, rates: FxRates) -> Decimal:
    src = (from_currency or "IDR").upper()
    dst = (to_currency or "IDR").upper()
    if src == dst:
        return amount
    if src not in rates.rates_per_usd or dst not in rates.rates_per_usd:
        return amount
    usd = amount / rates.rates_per_usd[src]
    out = usd * rates.rates_per_usd[dst]
    return out.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
