from __future__ import annotations

import logging
from typing import Any

from app.services import llm

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
        raw = llm.call(prompt, json_mode=True)
        parsed = llm.parse_json(raw)
        if isinstance(parsed, dict) and "type" in parsed:
            return parsed
    except llm.LLMError as e:
        log.warning("intent classify error, defaulting to log: %s", e)
    return {"type": "log"}


def extract_financial(
    text: str, categories: list[str], sources: list[str], today_ddmmyyyy: str
) -> list[dict[str, Any]]:
    """Port of processFinancialMessage Gemini prompt. Returns list of items."""
    from app.services.parse import now_local

    now = now_local()
    today_dow = now.strftime("%A")
    cats = ", ".join(categories)
    srcs = ", ".join(sources)
    prompt = f"""
Extract financial data from this text: "{text}"
Today is {today_dow}, {today_ddmmyyyy}. Use this to resolve ALL relative dates.

CRITICAL: All dates MUST be in dd/MM/yyyy format. Day comes FIRST, then month, then year.
Example: March 11, 2026 = "11/03/2026". NOT "03/11/2026".

DATE RESOLUTION RULES:
- "yesterday" = subtract 1 day from today
- "2 days ago" = subtract 2 days from today
- "last Monday", "last Friday" = most recent occurrence of that weekday
- "last week" = 7 days ago
- "this week" = the Monday of the current week
- "last month" = same day last month
- Always return an EXACT date in dd/MM/yyyy. NEVER return null for date.

TIME INFERENCE RULES:
- If user gives an explicit time ("at 3pm", "around 10am"), use it.
- If no explicit time, INFER from meal/activity context:
  - "breakfast", "morning coffee", "coffee", "nasi pagi" → "07:00:00"
  - "lunch", "makan siang" → "12:00:00"
  - "dinner", "makan malam" → "19:00:00"
  - "snack", "jajanan" → "15:00:00"
  - "midnight", "late night" → "23:00:00"
- If the date is TODAY and no time can be inferred, return null (system will use current time).
- If the date is a PAST DAY and no time can be inferred, return "00:00:00".

The message may contain MULTIPLE transactions. Return a JSON ARRAY of objects.
Even if there is only one transaction, wrap it in an array.

TRANSFER DETECTION: If the user says "transferred X from [Source A] to [Source B]" or "moved X from A to B" or "topup X from A to B", return TWO objects:
  1. {{"type": "Expense", "category": "Top-up", "amount": X, "source": "[Source A]", "description": "Transfer to [Source B]", "date": ..., "time": ...}}
  2. {{"type": "Income", "category": "Top-up", "amount": X, "source": "[Source B]", "description": "Transfer from [Source A]", "date": ..., "time": ...}}

CREDIT CARD PAYMENT — THIS IS THE MOST IMPORTANT RULE:
If the text mentions paying a credit card, credit card bill, credit payment, or paying off credit, it is a CREDIT PAYMENT, NOT a regular expense.
Phrases that mean credit payment: "paid credit card", "credit payment", "pay off credit", "paid X for credit card", "paid X credit card using [source]", "bayar kartu kredit", "bayar tagihan kartu".
When it is a credit payment:
  - Type: "Income" (this REDUCES the outstanding balance on the credit card)
  - Category: "Credit Payment"
  - Source: the CREDIT CARD being paid (e.g., "BCA Credit Card"), NOT the source used to pay it
  - Description: "Credit Payment"
  - is_internal: true
Example: "Paid 1.4mil credit card using BCA" → Income on "BCA Credit Card", NOT Expense on BCA.

Each object:
- "type": strictly "Income" or "Expense"
- "category": one of [{cats}], pick closest match
- "amount": raw integer. "40k" = 40000. "Rp. 21.900" = 21900. "1.5jt" = 1500000. "2jt" = 2000000.
- "description": short description. Fix typos. Proper capitalization. No emojis.
- "date": "dd/MM/yyyy". NEVER null — always resolve to an exact date.
- "time": "HH:mm:ss" or null (only null if date is today and no time context).
- "source": one of [{srcs}] or null. If no source mentioned, return null.

If no clear financial data, return an empty array [].
"""
    raw = llm.call(prompt, json_mode=True)
    parsed = llm.parse_json(raw)
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
    from app.services.parse import now_local

    now = now_local()
    today_dow = now.strftime("%A")
    cats = ", ".join(categories)
    srcs = ", ".join(sources)
    prompt = f"""
Listen to/watch this media and determine what the user wants.
Today is {today_dow}, {today_ddmmyyyy}. Use this to resolve ALL relative dates.

STEP 1 - FIRST determine the PRIMARY INTENT:
- Is the user ASKING A QUESTION about their finances?
- Or is the user LOGGING a transaction?

STEP 2 - Return JSON:

IF QUESTION: {{"intent": "query", "question": "transcribed question here"}}

IF LOGGING: a JSON ARRAY of transaction objects (even for single transaction).
Each: {{"intent": "log", "type": "Income"|"Expense", "category": one of [{cats}], "amount": int, "description": str, "date": "dd/MM/yyyy", "time": "HH:mm:ss"|null, "source": one of [{srcs}]|null, "is_internal": bool}}

DATE RULES: "yesterday" = subtract 1 day. "last Monday" = most recent Monday. Always return exact dd/MM/yyyy date. NEVER null.
TIME RULES: Infer from context (breakfast→07:00, lunch→12:00, dinner→19:00). If today and no context, return null. If past day and no context, return "00:00:00".

CREDIT CARD PAYMENT: If paying credit card bill → Type: "Income", Category: "Credit Payment", Source: the credit card name, is_internal: true.
TRANSFER: "transferred X from A to B" → two objects (Expense on A + Income on B, both category "Top-up", both is_internal: true).
"40k"=40000. No emojis.
If nothing financial, return [].
"""
    raw = llm.call_with_media(prompt, base64_data, mime_type)
    parsed = llm.parse_json(raw)

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
