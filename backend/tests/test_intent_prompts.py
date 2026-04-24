"""Regression guards for the Gemini prompts: the amount/source rules users
rely on must stay in the prompts. If someone refactors them away, these
tests fail loudly."""
from __future__ import annotations

from unittest.mock import patch

from app.services import intent


def _captured_prompt(text: str = "Spent 3.8 for gift") -> str:
    captured: dict[str, str] = {}

    def fake_call(prompt: str, json_mode: bool = False) -> str:
        _ = json_mode
        captured["prompt"] = prompt
        return "[]"

    with patch.object(intent.llm, "call", side_effect=fake_call):
        intent.extract_financial(text, ["Gifts"], ["BCA", "BCA Credit Card"], "24/04/2026")
    return captured["prompt"]


def test_prompt_rules_out_bare_decimal_as_thousands():
    p = _captured_prompt()
    lower = p.lower()
    # The critical rule: "3.8" must stay 3.8, not become 3800.
    assert "3.8" in p and "literal" in lower
    assert "never" in lower and "3800" in p


def test_prompt_calls_out_credit_as_credit_card_source():
    p = _captured_prompt("spent 15 on lunch with credit")
    lower = p.lower()
    assert "credit" in lower
    # Must explicitly map bare "credit" to the credit card source.
    assert "credit card" in lower
