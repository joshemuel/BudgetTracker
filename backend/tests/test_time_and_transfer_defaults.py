from datetime import datetime

from app.services.parse import resolve_occurred_at, tz


def test_resolve_occurred_at_today_without_time_uses_current_time():
    now = datetime.now(tz()).replace(microsecond=654321)
    dt = resolve_occurred_at(now.strftime("%d/%m/%Y"), None, now)
    assert dt.date() == now.date()
    assert dt.hour == now.hour
    assert dt.minute == now.minute
    assert dt.second == now.second


def test_resolve_occurred_at_past_day_defaults_to_noon():
    now = datetime(2026, 4, 18, 9, 30, 10, tzinfo=tz())
    dt = resolve_occurred_at("17/04/2026", None, now)
    assert dt.isoformat().endswith("12:00:00+07:00") or (
        dt.hour == 12 and dt.minute == 0 and dt.second == 0
    )
