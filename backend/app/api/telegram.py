from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import AppState, Category, Source, User
from app.services import financial, intent, query, telegram
from app.services.auth import verify_password
from app.services.parse import now_local, resolve_source_name

log = logging.getLogger(__name__)

router = APIRouter(prefix="/telegram", tags=["telegram"])

HELLO = (
    "Hey there! Leo is awake and ready. Tell me what you spent, earned, "
    "or ask me anything about your finances."
)
LOGIN_PROMPT = "Send `/login <username> <password>` to connect this chat to your account."
CREDIT_HELP_EMPTY = "No credit cards configured yet."
PENDING_SOURCE_PREFIX = "PENDING_SOURCE_CREATE"
PENDING_SOURCE_CHOICE_PREFIX = "PENDING_SOURCE_CHOICE"


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


def _pending_source_key(user_id: int) -> str:
    return f"{PENDING_SOURCE_PREFIX}:{user_id}"


def _pending_source_choice_key(user_id: int) -> str:
    return f"{PENDING_SOURCE_CHOICE_PREFIX}:{user_id}"


def _pending_source_state(db: Session, user_id: int) -> AppState | None:
    return db.query(AppState).filter_by(key=_pending_source_key(user_id)).one_or_none()


def _pending_source_choice_state(db: Session, user_id: int) -> AppState | None:
    return db.query(AppState).filter_by(key=_pending_source_choice_key(user_id)).one_or_none()


def _set_pending_source_state(
    db: Session,
    user_id: int,
    source_name: str,
    original_text: str,
) -> None:
    payload = {
        "source_name": source_name,
        "original_text": original_text,
    }
    state = _pending_source_state(db, user_id)
    if state is None:
        db.add(AppState(key=_pending_source_key(user_id), value=payload))
    else:
        state.value = payload
    db.commit()


def _set_pending_source_choice_state(
    db: Session,
    user_id: int,
    original_text: str,
    items: list[dict[str, Any]],
    target_indexes: list[int],
    options: list[str],
) -> None:
    payload: dict[str, Any] = {
        "original_text": original_text,
        "items": items,
        "target_indexes": target_indexes,
        "options": options,
    }
    state = _pending_source_choice_state(db, user_id)
    if state is None:
        db.add(AppState(key=_pending_source_choice_key(user_id), value=payload))
    else:
        state.value = payload
    db.commit()


def _clear_pending_source_state(db: Session, user_id: int) -> None:
    state = _pending_source_state(db, user_id)
    if state is not None:
        db.delete(state)
        db.commit()


def _clear_pending_source_choice_state(db: Session, user_id: int) -> None:
    state = _pending_source_choice_state(db, user_id)
    if state is not None:
        db.delete(state)
        db.commit()


def _is_yes(text: str) -> bool:
    t = text.strip().lower()
    return t in {"y", "yes", "ya", "yep", "ok", "oke", "create", "create it"}


def _is_no(text: str) -> bool:
    t = text.strip().lower()
    return t in {"n", "no", "nope", "cancel", "skip"}


def _is_transfer_like_item(item: dict[str, Any]) -> bool:
    if item.get("is_internal") is True:
        return True
    desc = str(item.get("description") or "").strip().lower()
    return desc.startswith("transfer to ") or desc.startswith("transfer from ")


def _missing_sources(items: list[dict[str, Any]], known_sources: list[str]) -> list[str]:
    known = {s.lower() for s in known_sources}
    missing: list[str] = []
    seen: set[str] = set()

    for item in items:
        if not _is_transfer_like_item(item):
            continue
        raw = str(item.get("source") or "").strip()
        if not raw:
            continue
        resolved = resolve_source_name(raw, known_sources, raw)
        if resolved.lower() in known:
            continue
        key = raw.lower()
        if key in seen:
            continue
        seen.add(key)
        missing.append(raw)
    return missing


def _missing_transfer_sources(items: list[dict[str, Any]], known_sources: list[str]) -> list[str]:
    transfers = [item for item in items if _is_transfer_like_item(item)]
    return _missing_sources(transfers, known_sources)


def _contains_topup_phrase(text: str) -> bool:
    return re.search(r"\btop\s*-?\s*up\b|\btopup\b", text.strip().lower()) is not None


def _contains_credit_card_phrase(text: str) -> bool:
    return (
        re.search(
            r"\bcredit\s*card\b|\bkartu\s*kredit\b|\bcc\b|\bkredit\b",
            text.strip().lower(),
        )
        is not None
    )


def _is_generic_credit_source_label(name: str) -> bool:
    tokens = re.sub(r"[^a-z0-9]+", " ", name.lower()).strip().split()
    if not tokens:
        return False
    stop = {"my", "the", "a", "an", "nya", "ini", "that", "this", "pakai", "use"}
    kept = [t for t in tokens if t not in stop]
    if not kept:
        return False
    generic = {"credit", "card", "cc", "kredit", "kartu"}
    return all(t in generic for t in kept)


def _credit_source_targets(
    items: list[dict[str, Any]],
    original_text: str,
    source_names: list[str],
    credit_source_names: list[str],
) -> list[int]:
    if not credit_source_names:
        return []

    credit_set = {s.lower() for s in credit_source_names}
    has_credit_phrase = _contains_credit_card_phrase(original_text)
    targets: list[int] = []

    for idx, item in enumerate(items):
        if _is_transfer_like_item(item):
            continue

        category = str(item.get("category") or "").strip().lower()
        raw_source = str(item.get("source") or "").strip()

        if raw_source:
            raw_generic = _is_generic_credit_source_label(raw_source)
            resolved = resolve_source_name(raw_source, source_names, raw_source)
            resolved_is_credit = resolved.lower() in credit_set

            if raw_generic:
                targets.append(idx)
                continue

            if category == "credit payment" and not resolved_is_credit:
                targets.append(idx)
            continue

        if category == "credit payment" or (has_credit_phrase and len(items) == 1):
            targets.append(idx)

    return sorted(set(targets))


def _credit_choice_prompt(options: list[str]) -> str:
    options_text = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(options))
    return (
        "I found multiple credit cards. Which one should I use?\n"
        f"{options_text}\n"
        "Reply with the number (e.g. 1) or card name. Reply 'no' to cancel."
    )


def _pick_source_from_reply(text: str, options: list[str]) -> str | None:
    t = text.strip()
    if not t:
        return None
    if t.isdigit():
        idx = int(t) - 1
        if 0 <= idx < len(options):
            return options[idx]

    resolved = resolve_source_name(t, options, "")
    for opt in options:
        if opt.lower() == resolved.lower():
            return opt
    return None


def _handle_pending_source_choice_reply(
    db: Session,
    user: User,
    chat_id: int | str,
    text: str,
) -> bool:
    state = _pending_source_choice_state(db, user.id)
    if state is None:
        return False

    value = state.value if isinstance(state.value, dict) else {}
    options = [str(x).strip() for x in (value.get("options") or []) if str(x).strip()]
    if len(options) < 2:
        _clear_pending_source_choice_state(db, user.id)
        telegram.send_message(chat_id, "That card selection expired. Please resend the transaction.")
        return True

    if _is_no(text):
        _clear_pending_source_choice_state(db, user.id)
        telegram.send_message(chat_id, "Got it, I cancelled that credit-card log.")
        return True

    chosen = _pick_source_from_reply(text, options)
    if chosen is None:
        telegram.send_message(chat_id, _credit_choice_prompt(options))
        return True

    raw_items = value.get("items") or []
    items = [i for i in raw_items if isinstance(i, dict)]
    targets_raw = value.get("target_indexes") or []
    targets: list[int] = []
    for i in targets_raw:
        try:
            idx = int(i)
        except Exception:
            continue
        if 0 <= idx < len(items):
            targets.append(idx)

    if not items or not targets:
        _clear_pending_source_choice_state(db, user.id)
        telegram.send_message(chat_id, "That card selection expired. Please resend the transaction.")
        return True

    for idx in targets:
        items[idx]["source"] = chosen

    try:
        outcome = financial.log_items(db, user, items)
    except Exception as e:
        log.exception("failed to log pending source choice: %s", e)
        telegram.send_message(chat_id, "I couldn't finish that log. Please resend the transaction.")
        return True

    _clear_pending_source_choice_state(db, user.id)
    telegram.send_message(chat_id, f"Using source '{chosen}'.\n\n{outcome.as_message()}")
    return True


def _handle_pending_source_reply(
    db: Session,
    user: User,
    chat_id: int | str,
    text: str,
) -> bool:
    state = _pending_source_state(db, user.id)
    if state is None:
        return False

    source_name = str(state.value.get("source_name") or "").strip()
    original_text = str(state.value.get("original_text") or "").strip()
    if not source_name or not original_text:
        db.delete(state)
        db.commit()
        return False

    if _is_no(text):
        db.delete(state)
        db.commit()
        telegram.send_message(chat_id, "Got it, I won't create that source.")
        return True

    if not _is_yes(text):
        telegram.send_message(
            chat_id,
            f"Create source '{source_name}'? Reply 'yes' to create or 'no' to cancel.",
        )
        return True

    src = Source(
        user_id=user.id,
        name=source_name,
        currency=(user.default_currency or "IDR").upper(),
        starting_balance=0,
        is_credit_card=False,
        active=True,
    )
    db.add(src)
    db.delete(state)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _clear_pending_source_state(db, user.id)
        telegram.send_message(
            chat_id,
            f"Source '{source_name}' already exists now. I'll use it.",
        )
    else:
        telegram.send_message(chat_id, f"Created source '{source_name}'. Logging it now.")

    _handle_text(db, user, chat_id, original_text)
    return True


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

    if _handle_pending_source_choice_reply(db, user, chat_id, t):
        return

    if _handle_pending_source_reply(db, user, chat_id, t):
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

    active_sources = db.query(Source).filter_by(user_id=user.id, active=True).order_by(Source.name).all()
    source_names = [s.name for s in active_sources]
    credit_source_names = [s.name for s in active_sources if s.is_credit_card]

    credit_targets = _credit_source_targets(items, t, source_names, credit_source_names)
    if credit_targets:
        if len(credit_source_names) == 1:
            only = credit_source_names[0]
            for idx in credit_targets:
                items[idx]["source"] = only
        elif len(credit_source_names) > 1:
            _set_pending_source_choice_state(
                db,
                user.id,
                original_text=t,
                items=items,
                target_indexes=credit_targets,
                options=credit_source_names,
            )
            telegram.send_message(chat_id, _credit_choice_prompt(credit_source_names))
            return

    missing_sources = _missing_transfer_sources(items, srcs)
    if not missing_sources and _contains_topup_phrase(t):
        missing_sources = _missing_sources(items, srcs)
    if missing_sources:
        missing = missing_sources[0]
        _set_pending_source_state(db, user.id, missing, t)
        telegram.send_message(
            chat_id,
            f"I couldn't find source '{missing}'. Create it now? Reply 'yes' to create or 'no' to cancel.",
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
