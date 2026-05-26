from types import SimpleNamespace
from unittest.mock import patch

from app.schemas.auth import UserOut
from app.schemas.common import TransactionIn
from app.services import intent
from app.services.currency_mode import resolve_entry_currency, source_currency_rows


def test_resolve_entry_currency_uses_source_while_sources_are_enabled():
    assert (
        resolve_entry_currency(
            sources_enabled=True,
            explicit_currency="SGD",
            source_currency="AUD",
            default_currency="IDR",
        )
        == "AUD"
    )


def test_resolve_entry_currency_defaults_when_sources_are_disabled():
    assert (
        resolve_entry_currency(
            sources_enabled=False,
            explicit_currency=None,
            source_currency="AUD",
            default_currency="SGD",
        )
        == "SGD"
    )


def test_source_currency_rows_only_include_active_currency_sources():
    rows = source_currency_rows(
        [
            SimpleNamespace(id=1, currency="IDR", active=True),
            SimpleNamespace(id=2, currency="IDR", active=False),
            SimpleNamespace(id=3, currency="SGD", active=True),
        ]
    )

    assert rows == {"IDR": [1], "SGD": [3]}


def test_transaction_input_accepts_currency_without_a_visible_source():
    payload = TransactionIn.model_validate(
        {
            "occurred_at": "2026-05-22T07:30:00Z",
            "type": "expense",
            "category_id": 2,
            "amount": "42",
            "currency": "SGD",
        }
    )

    assert payload.source_id is None
    assert payload.currency == "SGD"


def test_user_output_exposes_sources_enabled_preference():
    user = UserOut.model_validate(
        SimpleNamespace(
            id=1,
            username="josia",
            telegram_chat_id=None,
            default_currency="IDR",
            default_expense_source_id=2,
            sources_enabled=False,
        )
    )

    assert user.sources_enabled is False


def test_chat_extraction_prompt_requests_currency_metadata():
    captured: dict[str, str] = {}

    def fake_call(prompt: str, json_mode: bool = False) -> str:
        del json_mode
        captured["prompt"] = prompt
        return "[]"

    with patch.object(intent.llm, "call_logging", side_effect=fake_call):
        intent.extract_financial("spent 12 SGD on coffee", ["Coffee"], ["DBS"], "05/22/2026")

    assert '"currency"' in captured["prompt"]
    assert "default currency" in captured["prompt"].lower()
