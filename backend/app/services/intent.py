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
- If no explicit time, only infer when there is a clear temporal cue:
  - "breakfast", "morning" → "07:00:00"
  - "lunch", "noon", "makan siang" → "12:00:00"
  - "dinner", "evening", "makan malam" → "19:00:00"
  - "snack", "afternoon", "jajanan" → "15:00:00"
  - "midnight", "late night" → "23:00:00"
- NEVER infer time from item/category words alone (example: "coffee" alone is not a time cue).
- If the date is TODAY and no explicit time is given, return null (system will use current time).
- If the date is a PAST DAY and no explicit time can be inferred, return "12:00:00".

The message may contain MULTIPLE transactions. Return a JSON ARRAY of objects.
Even if there is only one transaction, wrap it in an array.

TRANSFER DETECTION: If the user says "transferred X from [Source A] to [Source B]", "moved X from A to B", "topup X from A to B", or "top up [Source B] for X", return TWO objects:
  1. {{"type": "Expense", "category": "Untrackable", "amount": X, "source": "[Source A]" (or null if not specified), "description": "Transfer to [Source B]", "date": ..., "time": ..., "is_internal": true}}
  2. {{"type": "Income", "category": "Untrackable", "amount": X, "source": "[Source B]", "description": "Transfer from [Source A]", "date": ..., "time": ..., "is_internal": true}}

CREDIT CARD PAYMENT vs CREDIT CARD PURCHASE (IMPORTANT):
Only classify as CREDIT PAYMENT when the user is clearly paying debt/bill/statement.
Strong bill-payment cues: "bill", "tagihan", "statement", "outstanding", "pay off", "settle", "bayar tagihan", "bayar cicilan kartu".

When it is a credit payment:
  - Type: "Income" (reduces card outstanding)
  - Category: "Credit Payment"
  - Source: the CREDIT CARD being paid (e.g., "BCA Credit Card")
  - Description: "Credit Payment"
  - is_internal: true

If user is buying/spending USING a credit card ("spent 80k with credit card", "bought lunch pakai kartu kredit"), this is a NORMAL EXPENSE, NOT "Credit Payment".
For card purchases:
  - Type: "Expense"
  - Category: best match from category list
  - Source: the credit card source used for purchase
  - is_internal: false unless the text is clearly an internal transfer/payment.

If wording is ambiguous, prefer NORMAL EXPENSE unless there is explicit bill/debt payment language.

Each object:
- "type": strictly "Income" or "Expense"
- "category": one of [{cats}], pick closest match
- "amount": raw number (integer or decimal). Rules:
    * A plain decimal is LITERAL. "3.8" = 3.8. "0.5" = 0.5. "12.75" = 12.75. NEVER multiply a bare decimal by 1,000.
    * Thousand/million SHORTHANDS are ONLY valid with an explicit suffix: "k", "rb", "ribu", "jt", "juta", "m".
      "40k" = 40000. "3.8k" = 3800. "500rb" = 500000. "1.5jt" = 1500000. "2jt" = 2000000.
    * Indonesian thousand separator with explicit "Rp" prefix keeps its digits: "Rp. 21.900" = 21900, "Rp 3.800" = 3800.
    * Without "Rp" and without a k/jt/etc suffix, dots are decimal points. "3.8" stays 3.8. Never guess it to be 3,800.
- "description": short description. Fix typos. Proper capitalization. No emojis.
- "date": "dd/MM/yyyy". NEVER null — always resolve to an exact date.
- "time": "HH:mm:ss" or null (only null if date is today and no time context).
- "source": source name explicitly mentioned by the user, or null if absent. It may be outside [{srcs}] when user mentions a new source.
    * When the user says just "credit" (or "kredit"), that's the credit card — return "credit card" as the source.

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
Each: {{"intent": "log", "type": "Income"|"Expense", "category": one of [{cats}], "amount": number (int or decimal), "description": str, "date": "dd/MM/yyyy", "time": "HH:mm:ss"|null, "source": one of [{srcs}]|null, "is_internal": bool}}

DATE RULES: "yesterday" = subtract 1 day. "last Monday" = most recent Monday. Always return exact dd/MM/yyyy date. NEVER null.
TIME RULES: Infer only from explicit temporal cues (breakfast/morning→07:00, lunch/noon→12:00, dinner/evening→19:00). Do not infer from words like "coffee" alone. If today and no time is specified, return null. If past day and no time context, return "12:00:00".

CREDIT CARD PAYMENT vs PURCHASE:
- Credit card bill/debt payment (explicit bill/statement/tagihan/pay-off language) → Type: "Income", Category: "Credit Payment", Source: credit card, is_internal: true.
- Purchase using credit card ("spent/bought/paid ... with credit card") → normal "Expense", normal category, source = card, is_internal: false.
- If unclear, default to normal expense.
TRANSFER: "transferred X from A to B" / "top up B for X" → two objects (Expense on A + Income on B, both category "Untrackable", both is_internal: true).

AMOUNT: plain decimals are LITERAL ("3.8" = 3.8, never 3800). Thousand shorthands only with explicit suffix: "40k"=40000, "3.8k"=3800, "500rb"=500000, "1.5jt"=1500000. Indonesian thousand separator with explicit "Rp" ("Rp 21.900" = 21900) is fine; without Rp/k/jt, a dot is a decimal point.
SOURCE: if user says just "credit"/"kredit", treat it as the credit card.
No emojis.
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
