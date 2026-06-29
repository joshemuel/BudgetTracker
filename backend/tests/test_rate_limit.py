"""Per-user input-token rate limiting for the web 'Ask Leo' chat.

The unit tests drive the sliding window directly; the endpoint test proves the
gate is wired into POST /telegram/web_chat and returns a friendly 429 (with a
Retry-After header and a `detail` the frontend can surface) before any LLM work.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db.models import AppState
from app.db.session import SessionLocal
from app.services import rate_limit


def _clear(user_id: int) -> None:
    with SessionLocal() as db:
        row = db.query(AppState).filter_by(key=f"{rate_limit.RL_PREFIX}:{user_id}").one_or_none()
        if row is not None:
            db.delete(row)
            db.commit()


def test_estimate_tokens():
    assert rate_limit.estimate_tokens(text="") == 1  # floor of 1
    assert rate_limit.estimate_tokens(text="a" * 40) == 10  # ~4 chars/token
    assert rate_limit.estimate_tokens(media=True) == rate_limit.AUDIO_IMAGE_FLAT_TOKENS


def test_sliding_window_admits_then_blocks(db):
    uid = 9_900_001
    _clear(uid)
    try:
        # Three 30-token charges sit under a 100/min budget.
        for _ in range(3):
            rate_limit.check_and_consume(db, uid, 30, limit_per_min=100)
        # The fourth would reach 120 > 100 → blocked, with a sane retry hint.
        with pytest.raises(rate_limit.RateLimited) as exc:
            rate_limit.check_and_consume(db, uid, 30, limit_per_min=100)
        assert exc.value.retry_after >= 1
        # The rejected attempt is not charged: the window still holds exactly 3.
        row = db.query(AppState).filter_by(key=f"{rate_limit.RL_PREFIX}:{uid}").one_or_none()
        assert row is not None and len(row.value["entries"]) == 3
    finally:
        _clear(uid)


def test_window_prunes_old_entries(db):
    uid = 9_900_002
    _clear(uid)
    try:
        # Seed an entry older than the 60s window — it must be pruned, not counted.
        stale_ts = datetime.now(timezone.utc).timestamp() - (rate_limit.WINDOW_SECONDS + 5)
        db.add(
            AppState(
                key=f"{rate_limit.RL_PREFIX}:{uid}",
                value={"entries": [{"ts": stale_ts, "tok": 95}]},
            )
        )
        db.commit()
        # With the stale entry pruned, a 30-token charge fits under 100.
        rate_limit.check_and_consume(db, uid, 30, limit_per_min=100)
        row = db.query(AppState).filter_by(key=f"{rate_limit.RL_PREFIX}:{uid}").one_or_none()
        assert row is not None
        assert [e["tok"] for e in row.value["entries"]] == [30]
    finally:
        _clear(uid)


def test_web_chat_rate_limited_returns_429(auth_client: TestClient, monkeypatch):
    uid = int(auth_client.get("/auth/me").json()["id"])
    _clear(uid)
    # Pin the budget so low that any single message is rejected before touching
    # the LLM (the rejected request short-circuits, so no intent stub is needed).
    monkeypatch.setattr(get_settings(), "llm_input_tokens_per_minute", 1)
    try:
        resp = auth_client.post(
            "/telegram/web_chat", json={"text": "spent 5000 on coffee at the cafe"}
        )
        assert resp.status_code == 429, resp.text
        assert "Retry-After" in resp.headers
        assert "breath" in resp.json()["detail"]
    finally:
        _clear(uid)
