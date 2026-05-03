from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)


class LLMError(Exception):
    pass


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {get_settings().llm_api_key}",
        "Content-Type": "application/json",
    }


def _url() -> str:
    return f"{get_settings().llm_base_url.rstrip('/')}/chat/completions"


def _clean_llm_text(text: str) -> str:
    """Strip reasoning blocks and stray markdown fences some models return."""
    # Remove reasoning blocks
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    # Remove opening code fence (```json, ```, etc.)
    text = re.sub(r"^```(?:json|python|text)?\s*\n?", "", text, flags=re.IGNORECASE).strip()
    # Remove trailing code fence
    text = re.sub(r"\s*```\s*$", "", text).strip()
    return text


def _extract_text(body: dict[str, Any]) -> str:
    if "error" in body:
        raise LLMError(body["error"].get("message", "LLM API error"))
    try:
        content = body["choices"][0]["message"]["content"]
        return _clean_llm_text(content)
    except (KeyError, IndexError, TypeError) as e:
        raise LLMError("Empty LLM response") from e


def call(prompt: str, json_mode: bool = True, timeout: float = 45.0) -> str:
    """Default model (Gemini Flash-Lite) for intent classification and extraction."""
    payload: dict[str, Any] = {
        "model": get_settings().llm_model,
        "messages": [{"role": "user", "content": prompt}],
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    with httpx.Client(timeout=timeout) as c:
        r = c.post(_url(), json=payload, headers=_headers())
        if r.status_code == 429:
            raise LLMError("Hit the API rate limit. Try again later.")
        r.raise_for_status()
        return _extract_text(r.json())


def call_query(prompt: str, timeout: float = 45.0) -> str:
    """Uses Gemini Flash for natural language questions about finances."""
    payload: dict[str, Any] = {
        "model": get_settings().llm_query_model,
        "messages": [{"role": "user", "content": prompt}],
    }
    with httpx.Client(timeout=timeout) as c:
        r = c.post(_url(), json=payload, headers=_headers())
        if r.status_code == 429:
            raise LLMError("Hit the API rate limit. Try again later.")
        r.raise_for_status()
        return _extract_text(r.json())


def call_with_media(prompt: str, base64_data: str, mime_type: str, timeout: float = 60.0) -> str:
    """Uses Gemini Flash-Lite for everyday audio and image logging."""
    is_audio = mime_type.startswith("audio")
    media: dict[str, Any]
    if is_audio:
        subtype = mime_type.split("/", 1)[1].split(";", 1)[0].lower()
        media = {
            "type": "input_audio",
            "input_audio": {
                "data": base64_data,
                "format": {"mpeg": "mp3", "x-wav": "wav"}.get(subtype, subtype),
            },
        }
    else:
        media = {
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{base64_data}"},
        }
    payload: dict[str, Any] = {
        "model": get_settings().llm_model,
        "messages": [
            {
                "role": "user",
                "content": [media, {"type": "text", "text": prompt}],
            }
        ],
        "response_format": {"type": "json_object"},
    }
    with httpx.Client(timeout=timeout) as c:
        r = c.post(_url(), json=payload, headers=_headers())
        if r.status_code == 429:
            raise LLMError("Hit the API rate limit. Try again later.")
        r.raise_for_status()
        return _extract_text(r.json())


def parse_json(raw: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        log.warning("llm non-json: %s", raw[:400])
        raise LLMError("LLM returned non-JSON") from e
