from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

import httpx

from app.db.models import AppState

log = logging.getLogger(__name__)

SUPPORTED = {"IDR", "SGD", "JPY", "AUD"}
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
    if state:
        try:
            ts = datetime.fromisoformat(state.value["fetched_at"])
            rates = _to_decimal_map(state.value["rates"])
            stale = FxRates(rates_per_usd=rates, fetched_at=ts)
            if datetime.now(timezone.utc) - ts < timedelta(hours=12):
                return stale
        except Exception:
            log.warning("Invalid cached FX rates, refetching")

    try:
        fresh = _fetch_latest_rates()
    except Exception as e:
        log.warning("FX fetch failed: %s", e)
        if stale is not None:
            return stale
        # Last-resort fallback: no conversion (1:1) so API remains available.
        one = Decimal("1")
        return FxRates(
            rates_per_usd={"USD": one, "IDR": one, "SGD": one, "JPY": one, "AUD": one},
            fetched_at=datetime.now(timezone.utc),
        )

    payload = {
        "fetched_at": fresh.fetched_at.isoformat(),
        "rates": {k: str(v) for k, v in fresh.rates_per_usd.items()},
    }
    if state is None:
        state = AppState(key=STATE_KEY, value=payload)
        db.add(state)
    else:
        state.value = payload
    db.commit()
    return fresh


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
