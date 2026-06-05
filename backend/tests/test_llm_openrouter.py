from __future__ import annotations

from typing import Any

from app.config import Settings, get_settings
from app.services import llm


OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def _clear_llm_env(monkeypatch) -> None:
    for key in (
        "OPENROUTER_API_KEY",
        "LLM_API_KEY",
        "LLM_BASE_URL",
        "LLM_LOG_MODEL",
        "LLM_MODEL",
        "LLM_QUERY_MODEL",
        "LLM_MEDIA_MODEL",
        "LLM_OCR_MODEL",
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


def test_settings_default_to_openrouter_models(monkeypatch):
    _clear_llm_env(monkeypatch)

    settings = Settings(_env_file=None)

    assert settings.llm_base_url == OPENROUTER_BASE_URL
    assert settings.llm_model == "deepseek/deepseek-v4-flash"
    assert settings.llm_log_model == "deepseek/deepseek-v4-flash"
    assert settings.llm_query_model == "deepseek/deepseek-v4-flash"
    assert settings.llm_media_model == "google/gemini-2.5-flash-lite"
    assert settings.llm_ocr_model == "google/gemini-2.5-flash-lite"


def test_settings_read_openrouter_api_key(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")

    settings = Settings(_env_file=None)

    assert settings.llm_api_key == "or-test-key"


def test_call_uses_default_text_model_with_openrouter_headers(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")
    monkeypatch.setattr(llm.httpx, "Client", _FakeClient)
    _FakeClient.calls = []

    llm.call("Log 8.50 coffee")

    call = _FakeClient.calls[0]
    assert call["url"] == f"{OPENROUTER_BASE_URL}/chat/completions"
    assert call["headers"]["Authorization"] == "Bearer or-test-key"
    assert call["headers"]["HTTP-Referer"]  # OpenRouter ranking headers present
    assert call["headers"]["X-Title"] == "BudgetTracker"
    assert call["json"]["model"] == "deepseek/deepseek-v4-flash"
    assert call["json"]["response_format"] == {"type": "json_object"}
    assert call["json"]["provider"] == {"require_parameters": True}


def test_call_logging_uses_dedicated_log_model(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")
    monkeypatch.setenv("LLM_MODEL", "deepseek/deepseek-v4-pro")
    monkeypatch.setenv("LLM_LOG_MODEL", "deepseek/deepseek-v4-flash")
    monkeypatch.setattr(llm.httpx, "Client", _FakeClient)
    _FakeClient.calls = []

    llm.call_logging("Log 8.50 coffee")

    assert _FakeClient.calls[0]["json"]["model"] == "deepseek/deepseek-v4-flash"
    assert _FakeClient.calls[0]["json"]["provider"] == {"require_parameters": True}


def test_call_query_uses_query_model(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")
    monkeypatch.setattr(llm.httpx, "Client", _FakeClient)
    _FakeClient.calls = []

    llm.call_query("How much did I spend this month?")

    assert _FakeClient.calls[0]["json"]["model"] == "deepseek/deepseek-v4-flash"


def test_call_with_media_routes_audio_and_image_to_separate_models(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")
    monkeypatch.setenv("LLM_OCR_MODEL", "google/gemini-2.5-flash-lite")
    monkeypatch.setenv("LLM_MEDIA_MODEL", "google/gemini-2.5-flash-lite")
    monkeypatch.setattr(llm.httpx, "Client", _FakeClient)
    _FakeClient.calls = []

    llm.call_with_media("Read receipt", "IMAGEBASE64", "image/jpeg")
    llm.call_with_media("Transcribe spending", "AUDIOBASE64", "audio/wav")

    image_call = _FakeClient.calls[0]["json"]
    assert image_call["model"] == "google/gemini-2.5-flash-lite"
    image_content = image_call["messages"][0]["content"]
    assert image_content[0] == {
        "type": "image_url",
        "image_url": {"url": "data:image/jpeg;base64,IMAGEBASE64"},
    }
    assert image_content[1] == {"type": "text", "text": "Read receipt"}

    audio_call = _FakeClient.calls[1]["json"]
    assert audio_call["model"] == "google/gemini-2.5-flash-lite"
    audio_content = audio_call["messages"][0]["content"]
    assert audio_content[0] == {
        "type": "input_audio",
        "input_audio": {"data": "AUDIOBASE64", "format": "wav"},
    }
    assert audio_content[1] == {"type": "text", "text": "Transcribe spending"}
