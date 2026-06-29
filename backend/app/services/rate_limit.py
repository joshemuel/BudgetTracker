"""Per-user input-token rate limiting for the web "Ask Leo" chat.

A 60-second sliding window kept in the existing ``app_state`` JSONB table (one row
per user, key ``RL_LLM:{user_id}``). Each accepted request appends an
``{ts, tok}`` entry; entries older than the window are pruned on every call, so the
window self-bounds with no background sweep. The limit is on *estimated input
tokens* — cheap to compute and good enough to stop spam without metering the LLM.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import AppState

RL_PREFIX = "RL_LLM"
WINDOW_SECONDS = 60
# Flat input-token cost charged for an audio/image message (we can't cheaply size
# a base64 blob the way we size text, and media prompts carry a fixed system cost).
AUDIO_IMAGE_FLAT_TOKENS = 1500


class RateLimited(Exception):
    """Raised when consuming ``est_tokens`` would exceed the per-minute budget."""

    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        super().__init__(f"rate limited, retry after {retry_after}s")


def _key(user_id: int) -> str:
    return f"{RL_PREFIX}:{user_id}"


def estimate_tokens(*, text: str | None = None, media: bool = False) -> int:
    """Rough input-token estimate. ~4 chars/token for text; flat cost for media."""
    if media:
        return AUDIO_IMAGE_FLAT_TOKENS
    return max(1, len(text or "") // 4)


def _load_entries(row: AppState | None, cutoff: float) -> list[dict]:
    """Surviving (within-window) entries from a row, tolerant of malformed JSON."""
    if row is None:
        return []
    entries: list[dict] = []
    for entry in (row.value or {}).get("entries") or []:
        try:
            ts, tok = float(entry["ts"]), int(entry["tok"])
        except (TypeError, ValueError, KeyError):
            continue
        if ts > cutoff:
            entries.append({"ts": ts, "tok": tok})
    return entries


def _persist(db: Session, row: AppState | None, user_id: int, entries: list[dict]) -> None:
    value = {"entries": entries}
    if row is None:
        db.add(AppState(key=_key(user_id), value=value))
    else:
        # Reassign the whole dict so SQLAlchemy flags the JSONB column as dirty.
        row.value = value
    db.commit()


def check_and_consume(
    db: Session,
    user_id: int,
    est_tokens: int,
    limit_per_min: int | None = None,
) -> None:
    """Charge ``est_tokens`` against the user's window or raise ``RateLimited``.

    Prunes the window first, then admits the request only if the running total
    stays within the limit. On rejection the pruned window is still persisted so
    it stays bounded, and ``retry_after`` points at when the oldest entry ages out.
    """
    limit = limit_per_min if limit_per_min is not None else get_settings().llm_input_tokens_per_minute
    now = datetime.now(timezone.utc).timestamp()
    cutoff = now - WINDOW_SECONDS

    row = db.query(AppState).filter_by(key=_key(user_id)).one_or_none()
    entries = _load_entries(row, cutoff)
    used = sum(e["tok"] for e in entries)

    if used + est_tokens > limit:
        oldest = min((e["ts"] for e in entries), default=now)
        retry_after = max(1, int(oldest + WINDOW_SECONDS - now) + 1)
        _persist(db, row, user_id, entries)
        raise RateLimited(retry_after)

    entries.append({"ts": now, "tok": est_tokens})
    _persist(db, row, user_id, entries)
