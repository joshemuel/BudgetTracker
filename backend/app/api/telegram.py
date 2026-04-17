from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import AppState, Category, Source, User
from app.services import financial, intent, query, telegram
from app.services.auth import verify_password
from app.services.parse import now_local

log = logging.getLogger(__name__)

router = APIRouter(prefix="/telegram", tags=["telegram"])

HELLO = (
    "Hey there! Leo is awake and ready. Tell me what you spent, earned, "
    "or ask me anything about your finances."
)
LOGIN_PROMPT = "Send `/login <username> <password>` to connect this chat to your account."
CREDIT_HELP_EMPTY = "No credit cards configured yet."


def _user_for_chat(db: Session, chat_id: int | str) -> User | None:
    """Return the DB user bound to this chat_id, or None if the chat is not bound yet."""
    return db.query(User).filter_by(telegram_chat_id=str(chat_id)).one_or_none()


def _handle_login(db: Session, chat_id: int | str, text: str) -> None:
    parts = text.strip().split()
    if len(parts) != 3:
        telegram.send_message(chat_id, "Usage: /login <username> <password>")
        return
    _, username, password = parts
    user = db.query(User).filter_by(username=username).one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        telegram.send_message(chat_id, "Invalid credentials.")
        return
    cid = str(chat_id)
    # Evict any prior binding for this chat (different user) and for this user (different chat).
    db.query(User).filter(User.telegram_chat_id == cid, User.id != user.id).update(
        {"telegram_chat_id": None}
    )
    user.telegram_chat_id = cid
    db.commit()
    telegram.send_message(chat_id, f"Logged in as {user.username}. {HELLO}")


def _ensure_update_new(db: Session, update_id: int) -> bool:
    """Return True if this update_id hasn't been processed before."""
    row = db.query(AppState).filter_by(key="LAST_UPDATE_ID").one_or_none()
    last = int(row.value.get("id", 0)) if row else 0
    if update_id <= last:
        return False
    if row is None:
        db.add(AppState(key="LAST_UPDATE_ID", value={"id": update_id}))
    else:
        row.value = {"id": update_id}
    db.commit()
    return True


def _names(db: Session, user_id: int) -> tuple[list[str], list[str]]:
    cats = [c.name for c in db.query(Category).filter_by(user_id=user_id).all()]
    srcs = [s.name for s in db.query(Source).filter_by(user_id=user_id, active=True).all()]
    return cats, srcs


def _handle_text(db: Session, user: User, chat_id: int | str, text: str) -> None:
    t = text.strip()
    if t == "/start" or t == "/help":
        telegram.send_message(chat_id, HELLO)
        return
    if t == "/logout":
        user.telegram_chat_id = None
        db.commit()
        telegram.send_message(chat_id, "Chat unbound. Send /login to reconnect.")
        return
    cats, srcs = _names(db, user.id)
    itn = intent.classify(t, cats, srcs)
    kind = itn.get("type", "log")

    if kind == "query":
        answer = query.answer(db, user, t)
        telegram.send_message(chat_id, answer)
        return

    if kind == "show_credit":
        credit = query._credit_outstanding(db, user.id)
        if credit < 0:
            telegram.send_message(
                chat_id,
                f"Credit card outstanding: {int(credit):,}".replace(",", "."),
            )
        else:
            telegram.send_message(chat_id, "No outstanding credit balance.")
        return

    if kind == "delete_last":
        gone = financial.soft_delete_last(db, user)
        if gone is None:
            telegram.send_message(chat_id, "Nothing to delete.")
        else:
            telegram.send_message(
                chat_id,
                f"Removed last entry: {gone.type} of {int(gone.amount):,}".replace(",", ".")
                + f" ({gone.description or '—'}).",
            )
        return

    # Default: log
    today = now_local().strftime("%d/%m/%Y")
    try:
        items = intent.extract_financial(t, cats, srcs, today)
    except Exception as e:
        log.exception("extract_financial failed: %s", e)
        telegram.send_message(chat_id, "Leo hit a snag parsing that. Try again?")
        return
    if not items:
        telegram.send_message(
            chat_id,
            "Leo couldn't find any financial data. Try 'spent 50k on food'.",
        )
        return
    outcome = financial.log_items(db, user, items)
    telegram.send_message(chat_id, outcome.as_message())


def _handle_media(db: Session, user: User, chat_id: int | str, file_id: str, mime: str) -> None:
    b64 = telegram.download_file_b64(file_id)
    if not b64:
        telegram.send_message(chat_id, "Couldn't grab that file from Telegram.")
        return
    cats, srcs = _names(db, user.id)
    today = now_local().strftime("%d/%m/%Y")
    try:
        result = intent.extract_from_media(b64, mime, cats, srcs, today)
    except Exception as e:
        log.exception("extract_from_media failed: %s", e)
        telegram.send_message(chat_id, "Leo got confused by that one.")
        return

    if result["kind"] == "query":
        telegram.send_message(chat_id, query.answer(db, user, result["question"]))
    elif result["kind"] == "log":
        outcome = financial.log_items(db, user, result["items"])
        telegram.send_message(chat_id, outcome.as_message())
    else:
        telegram.send_message(chat_id, "Didn't catch anything financial in there.")


def dispatch_update(db: Session, update: dict[str, Any]) -> None:
    """Shared dispatch for both webhook and polling paths."""
    cb = update.get("callback_query")
    if cb:
        from app.services import subscriptions  # lazy to avoid import cycles

        chat_id = cb["message"]["chat"]["id"]
        user = _user_for_chat(db, chat_id)
        if user is None:
            telegram.answer_callback_query(cb["id"], "Please /login first.")
            return
        subscriptions.handle_callback(db, user, cb)
        return

    msg = update.get("message")
    if not msg:
        return
    chat_id = msg["chat"]["id"]
    text = msg.get("text", "") or ""

    if text.strip().startswith("/login"):
        _handle_login(db, chat_id, text)
        return

    user = _user_for_chat(db, chat_id)
    if user is None:
        telegram.send_message(chat_id, LOGIN_PROMPT)
        return

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
    elif text:
        _handle_text(db, user, chat_id, text)


@router.post("/webhook")
async def webhook(update: dict[str, Any], db: Session = Depends(get_db)):
    update_id = update.get("update_id")
    if update_id is None or not _ensure_update_new(db, int(update_id)):
        return {"ok": True}
    dispatch_update(db, update)
    return {"ok": True}


@router.post("/set_webhook")
def set_webhook(payload: dict[str, str]):
    """Admin helper: POST { url } to register the webhook URL with Telegram."""
    url = payload.get("url", "")
    if not url:
        return {"ok": False, "error": "missing url"}
    return telegram.set_webhook(url)
