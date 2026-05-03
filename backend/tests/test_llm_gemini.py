from __future__ import annotations

from typing import Any

from app.config import Settings, get_settings
from app.services import llm


GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"


def _clear_llm_env(monkeypatch) -> None:
    for key in (
        "GEMINI_API_KEY",
        "DASHSCOPE_API_KEY",
        "LLM_BASE_URL",
        "LLM_MODEL",
        "LLM_QUERY_MODEL",
    ):
        monkeypatch.delenv(key, raising=False)
    get_settings.cache_clear()


class _FakeResponse:
    status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return {"choices": [{"message": {"content": "{\"ok\": true}"}}]}


class _FakeClient:
    calls: list[dict[str, Any]] = []

    def __init__(self, timeout: float):
        self.timeout = timeout

    def __enter__(self) -> "_FakeClient":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> _FakeResponse:
        self.calls.append({"url": url, "json": json, "headers": headers})
        return _FakeResponse()


def test_settings_default_to_gemini_flash_models(monkeypatch):
    _clear_llm_env(monkeypatch)

    settings = Settings(_env_file=None)

    assert settings.llm_base_url == GEMINI_BASE_URL
    assert settings.llm_model == "gemini-2.5-flash-lite"
    assert settings.llm_query_model == "gemini-2.5-flash"


def test_settings_read_gemini_api_key(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")

    settings = Settings(_env_file=None)

    assert settings.llm_api_key == "gemini-test-key"


def test_call_uses_gemini_flash_lite_for_everyday_logging(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
    monkeypatch.setattr(llm.httpx, "Client", _FakeClient)
    _FakeClient.calls = []

    llm.call("Log 8.50 coffee")

    call = _FakeClient.calls[0]
    assert call["url"] == f"{GEMINI_BASE_URL}/chat/completions"
    assert call["headers"]["Authorization"] == "Bearer gemini-test-key"
    assert call["json"]["model"] == "gemini-2.5-flash-lite"
    assert call["json"]["response_format"] == {"type": "json_object"}


def test_call_query_uses_gemini_flash_for_questions(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
    monkeypatch.setattr(llm.httpx, "Client", _FakeClient)
    _FakeClient.calls = []

    llm.call_query("How much did I spend this month?")

    assert _FakeClient.calls[0]["json"]["model"] == "gemini-2.5-flash"


def test_call_with_media_uses_openai_compatible_gemini_payloads(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
    monkeypatch.setattr(llm.httpx, "Client", _FakeClient)
    _FakeClient.calls = []

    llm.call_with_media("Read receipt", "IMAGEBASE64", "image/jpeg")
    llm.call_with_media("Transcribe spending", "AUDIOBASE64", "audio/wav")

    image_content = _FakeClient.calls[0]["json"]["messages"][0]["content"]
    assert image_content[0] == {
        "type": "image_url",
        "image_url": {"url": "data:image/jpeg;base64,IMAGEBASE64"},
    }
    assert image_content[1] == {"type": "text", "text": "Read receipt"}

    audio_content = _FakeClient.calls[1]["json"]["messages"][0]["content"]
    assert audio_content[0] == {
        "type": "input_audio",
        "input_audio": {"data": "AUDIOBASE64", "format": "wav"},
    }
    assert audio_content[1] == {"type": "text", "text": "Transcribe spending"}
