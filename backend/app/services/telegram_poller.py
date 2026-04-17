from __future__ import annotations

import asyncio
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
    from app.api.telegram import _handle_media, _handle_text, _is_authorized, _user_for_chat

    db = SessionLocal()
    try:
        update_id = update.get("update_id")
        if update_id is None:
            return

        cb = update.get("callback_query")
        if cb:
            from app.services import subscriptions

            chat_id = cb["message"]["chat"]["id"]
            if not _is_authorized(chat_id):
                telegram.answer_callback_query(cb["id"], "Not allowed.")
                return
            user = _user_for_chat(db, chat_id)
            if user is None:
                telegram.answer_callback_query(cb["id"], "Unknown user.")
                return
            subscriptions.handle_callback(db, user, cb)
            return

        msg = update.get("message")
        if not msg:
            return
        chat_id = msg["chat"]["id"]
        if not _is_authorized(chat_id):
            telegram.send_message(chat_id, "Sorry, Leo only works for the boss.")
            return

        user = _user_for_chat(db, chat_id)
        if user is None:
            telegram.send_message(chat_id, "No user configured on the server.")
            return

        if user.telegram_chat_id is None:
            user.telegram_chat_id = str(chat_id)
            db.commit()

        if msg.get("voice"):
            _handle_media(db, user, chat_id, msg["voice"]["file_id"], "audio/ogg")
        elif msg.get("video_note"):
            _handle_media(db, user, chat_id, msg["video_note"]["file_id"], "video/mp4")
        elif msg.get("video"):
            _handle_media(
                db,
                user,
                chat_id,
                msg["video"]["file_id"],
                msg["video"].get("mime_type", "video/mp4"),
            )
        elif msg.get("text"):
            _handle_text(db, user, chat_id, msg["text"])
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
