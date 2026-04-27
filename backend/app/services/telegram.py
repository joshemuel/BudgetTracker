from __future__ import annotations

import base64
import logging

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)


def _base() -> str:
    return f"https://api.telegram.org/bot{get_settings().telegram_token}"


def _post_json(path: str, payload: dict, timeout: float) -> bool:
    try:
        with httpx.Client(timeout=timeout) as c:
            r = c.post(f"{_base()}/{path}", json=payload)
            r.raise_for_status()
            body = r.json()
            if isinstance(body, dict) and body.get("ok") is False:
                log.warning("telegram %s returned ok=false: %s", path, body)
                return False
            return True
    except httpx.HTTPError as e:
        log.exception("telegram %s failed: %s", path, e)
        return False
    except ValueError:
        # Telegram normally returns JSON with {"ok": ...}; if a proxy strips it,
        # treat successful HTTP status as delivered.
        return True


def send_message(
    chat_id: int | str,
    text: str,
    reply_markup: dict | None = None,
) -> bool:
    if not get_settings().telegram_token:
        log.info("telegram token unset — would send to %s: %s", chat_id, text[:80])
        return False
    payload: dict = {"chat_id": chat_id, "text": text}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return _post_json("sendMessage", payload, timeout=20.0)


def answer_callback_query(callback_query_id: str, text: str | None = None) -> bool:
    if not get_settings().telegram_token:
        return False
    return _post_json(
        "answerCallbackQuery",
        {"callback_query_id": callback_query_id, "text": text or ""},
        timeout=10.0,
    )


def edit_message_text(chat_id: int | str, message_id: int, text: str) -> bool:
    if not get_settings().telegram_token:
        return False
    return _post_json(
        "editMessageText",
        {"chat_id": chat_id, "message_id": message_id, "text": text},
        timeout=10.0,
    )


def download_file_b64(file_id: str) -> str | None:
    s = get_settings()
    if not s.telegram_token:
        return None
    try:
        with httpx.Client(timeout=30.0) as c:
            r = c.get(f"{_base()}/getFile", params={"file_id": file_id})
            r.raise_for_status()
            fp = r.json().get("result", {}).get("file_path")
            if not fp:
                return None
            dl = c.get(f"https://api.telegram.org/file/bot{s.telegram_token}/{fp}")
            dl.raise_for_status()
            return base64.b64encode(dl.content).decode("ascii")
    except httpx.HTTPError as e:
        log.exception("telegram download_file_b64 failed: %s", e)
        return None


def set_webhook(url: str) -> dict:
    with httpx.Client(timeout=15.0) as c:
        r = c.get(
            f"{_base()}/setWebhook",
            params={"url": url, "drop_pending_updates": "true"},
        )
        r.raise_for_status()
        return r.json()


def delete_webhook() -> dict:
    with httpx.Client(timeout=15.0) as c:
        r = c.get(f"{_base()}/deleteWebhook", params={"drop_pending_updates": "true"})
        r.raise_for_status()
        return r.json()


def get_updates(offset: int | None = None, timeout: int = 30) -> list[dict]:
    if not get_settings().telegram_token:
        return []
    params: dict = {"timeout": str(timeout)}
    if offset is not None:
        params["offset"] = str(offset)
    try:
        with httpx.Client(timeout=timeout + 5.0) as c:
            r = c.get(f"{_base()}/getUpdates", params=params)
            r.raise_for_status()
            return r.json().get("result", [])
    except httpx.HTTPError as e:
        log.exception("telegram get_updates failed: %s", e)
        return []
