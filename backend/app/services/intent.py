from __future__ import annotations

import logging
from typing import Any

from app.services import gemini

log = logging.getLogger(__name__)


def classify(text: str, categories: list[str], sources: list[str]) -> dict[str, Any]:
    """Port of classifyIntent. Returns { type: "log"|"query"|... , ... }."""
    cats = ", ".join(categories)
    srcs = ", ".join(sources)
    prompt = f"""
    Classify this message into exactly one intent.
    Message: "{text}"

    Intents:
    - "log": Recording a financial transaction (spent, earned, bought, paid, received, transferred, moved funds, credit payment, etc.)
    - "query": Asking a question about finances, requesting a summary, or asking for analysis
    - "show_credit": Asking about credit card balance/due (e.g., "how much do I owe on credit", "show credit card balance")
    - "delete_last": Deleting the most recent transaction ("delete last transaction", "undo last log")

    Current categories: {cats}
    Current sources: {srcs}

    Transfers like "transferred 10k from BCA to GoPay" are always "log".
    "Credit payment 500k" or "paid credit card bill" are "log" (they're transactions).

    Return a JSON object based on intent:
    - log: {{"type": "log"}}
    - query: {{"type": "query"}}
    - show_credit: {{"type": "show_credit"}}
    - delete_last: {{"type": "delete_last"}}
    """
    try:
        raw = gemini.call(prompt, json_mode=True)
        parsed = gemini.parse_json(raw)
        if isinstance(parsed, dict) and "type" in parsed:
            return parsed
    except gemini.GeminiError as e:
        log.warning("intent classify error, defaulting to log: %s", e)
    return {"type": "log"}


def extract_financial(
    text: str, categories: list[str], sources: list[str], today_ddmmyyyy: str
) -> list[dict[str, Any]]:
    """Port of processFinancialMessage Gemini prompt. Returns list of items."""
    cats = ", ".join(categories)
    srcs = ", ".join(sources)
    prompt = f"""
    Extract financial data from this text: "{text}"
    Today's date is {today_ddmmyyyy}.
    CRITICAL: All dates MUST be in dd/MM/yyyy format. Day comes FIRST, then month, then year.
    Example: March 11, 2026 = "11/03/2026". NOT "03/11/2026".

    The message may contain MULTIPLE transactions. Return a JSON ARRAY of objects.
    Even if there is only one transaction, wrap it in an array.

    TRANSFER DETECTION: If the user says "transferred X from [Source A] to [Source B]" or "moved X from A to B" or "topup X from A to B", return TWO objects:
      1. {{"type": "Expense", "category": "Top-up", "amount": X, "source": "[Source A]", "description": "Transfer to [Source B]", "date": ..., "time": ...}}
      2. {{"type": "Income", "category": "Top-up", "amount": X, "source": "[Source B]", "description": "Transfer from [Source A]", "date": ..., "time": ...}}

    CREDIT CARD PAYMENT: If the text mentions paying credit card bill, credit payment, or paying off credit:
      - Type: "Expense"
      - Category: "Credit Payment"
      - Source: the card being paid (e.g., "BCA Credit Card")
      - Description: should include "Credit Payment"

    Each object:
    - "type": strictly "Income" or "Expense"
    - "category": one of [{cats}], pick closest match
    - "amount": raw integer. "40k" = 40000. "Rp. 21.900" = 21900. "1.5jt" = 1500000. "2jt" = 2000000.
    - "description": short description. Fix typos. Proper capitalization. No emojis.
    - "date": "dd/MM/yyyy" or null (resolve relative dates relative to {today_ddmmyyyy})
    - "time": "HH:mm:ss" or null.
      ONLY return a time if the user gives an EXPLICIT clock time or temporal phrase like "at 3pm", "around 10am", "this morning".
      DO NOT infer time from what was purchased. "lunch", "dinner", "coffee" describe WHAT was bought, NOT when.
      If no explicit time or temporal phrase is stated, return null.
    - "source": one of [{srcs}] or null. If no source mentioned, return null.

    If no clear financial data, return an empty array [].
    """
    raw = gemini.call(prompt, json_mode=True)
    parsed = gemini.parse_json(raw)
    if isinstance(parsed, dict):
        return [parsed] if parsed else []
    if isinstance(parsed, list):
        return parsed
    return []


def extract_from_media(
    base64_data: str,
    mime_type: str,
    categories: list[str],
    sources: list[str],
    today_ddmmyyyy: str,
) -> dict[str, Any]:
    """Returns {kind: 'query', question: ...} or {kind: 'log', items: [...]} or {kind: 'none'}."""
    cats = ", ".join(categories)
    srcs = ", ".join(sources)
    prompt = f"""
    Listen to/watch this media and determine what the user wants.
    Today's date is {today_ddmmyyyy}.

    STEP 1 - FIRST determine the PRIMARY INTENT:
    - Is the user ASKING A QUESTION about their finances?
    - Or is the user LOGGING a transaction?

    STEP 2 - Return JSON:

    IF QUESTION: {{"intent": "query", "question": "transcribed question here"}}

    IF LOGGING: a JSON ARRAY of transaction objects (even for single transaction).
    Each: {{"intent": "log", "type": "Income"|"Expense", "category": one of [{cats}], "amount": int, "description": str, "date": "dd/MM/yyyy"|null, "time": "HH:mm:ss"|null, "source": one of [{srcs}]|null}}

    dd/MM/yyyy only. "40k"=40000. No emojis. Transfers return two objects (Top-up Expense + Top-up Income).
    If nothing financial, return [].
    """
    raw = gemini.call_with_media(prompt, base64_data, mime_type)
    parsed = gemini.parse_json(raw)

    if isinstance(parsed, dict):
        if parsed.get("intent") == "query" and parsed.get("question"):
            return {"kind": "query", "question": parsed["question"]}
        if not parsed:
            return {"kind": "none"}
        parsed = [parsed]

    if isinstance(parsed, list):
        if parsed and isinstance(parsed[0], dict) and parsed[0].get("intent") == "query":
            return {"kind": "query", "question": parsed[0].get("question", "")}
        items = [x for x in parsed if isinstance(x, dict) and x.get("intent") != "query"]
        if not items:
            return {"kind": "none"}
        return {"kind": "log", "items": items}

    return {"kind": "none"}
