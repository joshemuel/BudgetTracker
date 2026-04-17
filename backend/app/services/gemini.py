from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)


class GeminiError(Exception):
    pass


def _url() -> str:
    s = get_settings()
    return (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{s.gemini_model}:generateContent?key={s.gemini_api_key}"
    )


def _extract_text(body: dict[str, Any]) -> str:
    if "error" in body:
        raise GeminiError(body["error"].get("message", "Gemini API error"))
    try:
        return body["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as e:
        raise GeminiError("Empty Gemini response") from e


def call(prompt: str, json_mode: bool = True, timeout: float = 45.0) -> str:
    payload: dict[str, Any] = {"contents": [{"parts": [{"text": prompt}]}]}
    if json_mode:
        payload["generationConfig"] = {"responseMimeType": "application/json"}
    with httpx.Client(timeout=timeout) as c:
        r = c.post(_url(), json=payload)
        if r.status_code == 429:
            raise GeminiError(
                "Hit the Gemini free-tier limit. Resets at midnight Pacific Time."
            )
        r.raise_for_status()
        return _extract_text(r.json())


def call_with_media(
    prompt: str, base64_data: str, mime_type: str, timeout: float = 60.0
) -> str:
    payload = {
        "contents": [
            {
                "parts": [
                    {"inline_data": {"mime_type": mime_type, "data": base64_data}},
                    {"text": prompt},
                ]
            }
        ],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    with httpx.Client(timeout=timeout) as c:
        r = c.post(_url(), json=payload)
        if r.status_code == 429:
            raise GeminiError(
                "Hit the Gemini free-tier limit. Resets at midnight Pacific Time."
            )
        r.raise_for_status()
        return _extract_text(r.json())


def parse_json(raw: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        log.warning("gemini non-json: %s", raw[:400])
        raise GeminiError("Gemini returned non-JSON") from e
