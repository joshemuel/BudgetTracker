from __future__ import annotations

import logging
import threading
import time
from typing import Any

from app.db.session import SessionLocal
from app.services import telegram

log = logging.getLogger(__name__)

_running = False
_offset: int = 0


def _process_update(update: dict[str, Any]) -> None:
    from app.api.telegram import dispatch_update

    db = SessionLocal()
    try:
        dispatch_update(db, update)
    finally:
        db.close()


def _poll_loop() -> None:
    global _offset
    print("[POLLER] Starting poll loop")
    while _running:
        updates = telegram.get_updates(offset=_offset, timeout=30)
        print(f"[POLLER] Got {len(updates)} updates")
        for update in updates:
            _offset = update["update_id"] + 1
            _process_update(update)
        if not updates:
            time.sleep(1)


def start() -> None:
    global _running
    if _running:
        return
    _running = True
    t = threading.Thread(target=_poll_loop, daemon=True, name="telegram-poller")
    t.start()


def stop() -> None:
    global _running
    _running = False
