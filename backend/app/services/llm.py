from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import shutil
import subprocess
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)


class LLMError(Exception):
    pass


_GEMINI_SAFE_AUDIO_FORMATS = {"mp3", "wav"}


def _transcode_audio_to_mp3(b64_in: str, mime_type: str) -> str:
    """Transcode any browser/Telegram audio payload to base64-encoded MP3.

    Browser MediaRecorder (webm/opus) and Telegram voice notes (ogg/opus) are
    not natively accepted by Gemini's OpenAI-compatible audio input. We pipe
    everything through ffmpeg to land on a known-good mp3 stream.
    """
    if not shutil.which("ffmpeg"):
        raise LLMError("ffmpeg is not available for audio transcoding")
    try:
        raw = base64.b64decode(b64_in, validate=False)
    except (binascii.Error, ValueError) as e:
        raise LLMError(f"Invalid base64 audio payload: {e}") from e
    proc = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "24000",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "5",
            "-f",
            "mp3",
            "pipe:1",
        ],
        input=raw,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout:
        err = proc.stderr.decode("utf-8", errors="replace")[:400]
        raise LLMError(f"ffmpeg transcode failed (mime={mime_type}): {err}")
    return base64.b64encode(proc.stdout).decode("ascii")


def _headers() -> dict[str, str]:
    s = get_settings()
    return {
        "Authorization": f"Bearer {s.llm_api_key}",
        "Content-Type": "application/json",
        # OpenRouter ranking/analytics headers (ignored by other providers).
        "HTTP-Referer": s.llm_referer,
        "X-Title": s.llm_app_title,
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
    """Default model for general JSON calls."""
    payload: dict[str, Any] = {
        "model": get_settings().llm_model,
        "messages": [{"role": "user", "content": prompt}],
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
        # Only route to providers that honor response_format (json reliability).
        payload["provider"] = {"require_parameters": True}
    with httpx.Client(timeout=timeout) as c:
        r = c.post(_url(), json=payload, headers=_headers())
        if r.status_code == 429:
            raise LLMError("Hit the API rate limit. Try again later.")
        r.raise_for_status()
        return _extract_text(r.json())


def call_logging(prompt: str, json_mode: bool = True, timeout: float = 25.0) -> str:
    """Dedicated low-cost path for intent classification and transaction extraction."""
    payload: dict[str, Any] = {
        "model": get_settings().llm_log_model,
        "messages": [{"role": "user", "content": prompt}],
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
        payload["provider"] = {"require_parameters": True}
    with httpx.Client(timeout=timeout) as c:
        r = c.post(_url(), json=payload, headers=_headers())
        if r.status_code == 429:
            raise LLMError("Hit the API rate limit. Try again later.")
        r.raise_for_status()
        return _extract_text(r.json())


def call_query(prompt: str, timeout: float = 45.0) -> str:
    """Uses llm_query_model for natural-language questions about finances."""
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


def call_with_media(prompt: str, base64_data: str, mime_type: str, timeout: float = 45.0) -> str:
    """Audio → llm_media_model, image → llm_ocr_model (both default to a Gemini multimodal slug)."""
    is_audio = mime_type.startswith("audio")
    media: dict[str, Any]
    if is_audio:
        subtype = mime_type.split("/", 1)[1].split(";", 1)[0].lower()
        normalized = {"mpeg": "mp3", "x-wav": "wav"}.get(subtype, subtype)
        if normalized not in _GEMINI_SAFE_AUDIO_FORMATS:
            base64_data = _transcode_audio_to_mp3(base64_data, mime_type)
            normalized = "mp3"
        media = {
            "type": "input_audio",
            "input_audio": {
                "data": base64_data,
                "format": normalized,
            },
        }
    else:
        media = {
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{base64_data}"},
        }
    settings = get_settings()
    payload: dict[str, Any] = {
        "model": settings.llm_media_model if is_audio else settings.llm_ocr_model,
        "messages": [
            {
                "role": "user",
                "content": [media, {"type": "text", "text": prompt}],
            }
        ],
        "response_format": {"type": "json_object"},
        "provider": {"require_parameters": True},
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
