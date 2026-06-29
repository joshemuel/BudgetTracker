"""Google Sheets auto-sync: push a user's ledger into a spreadsheet we own.

Opt-in is the presence of a GoogleCredential row. `sync_user` does a full
re-write of the workbook (Transactions / Budgets / Wallets tabs) — always
correct regardless of inserts/edits/deletes — and is shared by the manual
"Sync now" endpoint and the hourly scheduler job (`sync_all`).

We talk to the Sheets REST API with httpx (already a dependency) rather than
pulling in google-api-python-client. The OAuth scope is drive.file, so we can
only touch the spreadsheet we created.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from decimal import Decimal

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Budget, Category, GoogleCredential, Source, Transaction, User
from app.db.session import SessionLocal
from app.services import google_oauth
from app.services.parse import tz

log = logging.getLogger(__name__)

SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"
# Overview leads so a Sheets-first user lands on the dashboard, not raw rows.
# "ChartData" is a hidden helper tab holding the series the Overview charts plot —
# native Sheets charts bind to cell ranges, not inline data, so we stage them here.
CHART_DATA_TAB = "ChartData"
TAB_TITLES = ["Overview", "Transactions", "Budgets", "Wallets", CHART_DATA_TAB]


class SheetsError(Exception):
    """Any failure talking to the Google Sheets API."""


class SpreadsheetGone(SheetsError):
    """The stored spreadsheet no longer exists (user deleted it) — recreate it."""


def _auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


# --- Styling palette ---------------------------------------------------------
# Book-tab hues (edge = saturated label tone for tabs/headers; band = soft tint
# for alternating rows; wash = section-title fill). Deliberately the same family
# the web app uses, so the spreadsheet feels like part of the product.
_TAB_EDGE = {
    "Overview": "#41708f",  # dusty blue
    "Transactions": "#8f6c1c",  # manila
    "Budgets": "#a4512c",  # terracotta
    "Wallets": "#5b7434",  # sage
}
_TAB_BAND = {
    "Overview": "#eaf1f6",
    "Transactions": "#f6efdc",
    "Budgets": "#f7e7dc",
    "Wallets": "#edf2e1",
}
_SECTION_WASH = "#e7eef3"  # soft blue-grey behind Overview section titles
_STATUS_BG = {
    "Over": "#f2c9c0",  # red wash
    "Behind": "#f4e0c2",  # amber wash
    "Ahead": "#d7e8c8",  # green wash
    "On track": "#e0e8d2",  # neutral green
}
_INK = "#19170f"
_MUTE = "#746b57"
_WHITE = "#ffffff"

# Negatives render red in every money cell. Mixed-currency columns (per-row
# currency) drop the decimals rule; report-currency cells pick decimals by code.
_MONEY_MIXED = "#,##0.##;[Red]-#,##0.##"


def _money_pattern(currency: str) -> str:
    if currency in {"IDR", "JPY"}:
        return "#,##0;[Red]-#,##0"
    return "#,##0.00;[Red]-#,##0.00"


def _rgb(hex_color: str) -> dict[str, float]:
    h = hex_color.lstrip("#")
    return {
        "red": int(h[0:2], 16) / 255,
        "green": int(h[2:4], 16) / 255,
        "blue": int(h[4:6], 16) / 255,
    }


# --- Sheets REST calls -------------------------------------------------------


def create_spreadsheet(access_token: str, title: str) -> tuple[str, str]:
    body = {
        "properties": {"title": title},
        "sheets": [{"properties": {"title": t}} for t in TAB_TITLES],
    }
    with httpx.Client(timeout=30.0) as c:
        r = c.post(SHEETS_API, headers=_auth_headers(access_token), json=body)
    if r.status_code not in (200, 201):
        raise SheetsError(f"create spreadsheet failed: {r.status_code} {r.text[:200]}")
    data = r.json()
    sid = data["spreadsheetId"]
    url = data.get("spreadsheetUrl") or f"https://docs.google.com/spreadsheets/d/{sid}"
    return sid, url


def write_workbook(access_token: str, spreadsheet_id: str, tabs: dict[str, list[list]]) -> None:
    """Clear each tab then write its rows from A1 (full re-write)."""
    headers = _auth_headers(access_token)
    base = f"{SHEETS_API}/{spreadsheet_id}"
    with httpx.Client(timeout=30.0) as c:
        clear = c.post(
            f"{base}/values:batchClear", headers=headers, json={"ranges": list(tabs.keys())}
        )
        if clear.status_code == 404:
            raise SpreadsheetGone(spreadsheet_id)
        if clear.status_code != 200:
            raise SheetsError(f"clear failed: {clear.status_code} {clear.text[:200]}")
        payload = {
            "valueInputOption": "RAW",
            "data": [{"range": f"{name}!A1", "values": rows} for name, rows in tabs.items()],
        }
        upd = c.post(f"{base}/values:batchUpdate", headers=headers, json=payload)
        if upd.status_code == 404:
            raise SpreadsheetGone(spreadsheet_id)
        if upd.status_code != 200:
            raise SheetsError(f"update failed: {upd.status_code} {upd.text[:200]}")


def ensure_tabs(access_token: str, spreadsheet_id: str, titles: list[str]) -> None:
    """Add any of ``titles`` missing from the workbook.

    Workbooks created before a tab existed (e.g. ChartData) would otherwise 400 on
    the first write to that range. New spreadsheets already have every tab, so this
    is a cheap no-op metadata check in the common case.
    """
    headers = _auth_headers(access_token)
    base = f"{SHEETS_API}/{spreadsheet_id}"
    with httpx.Client(timeout=30.0) as c:
        meta = c.get(base, headers=headers, params={"fields": "sheets.properties.title"})
        if meta.status_code == 404:
            raise SpreadsheetGone(spreadsheet_id)
        if meta.status_code != 200:
            raise SheetsError(f"meta failed: {meta.status_code} {meta.text[:200]}")
        existing = {
            sh["properties"]["title"] for sh in meta.json().get("sheets", []) if "properties" in sh
        }
        missing = [t for t in titles if t not in existing]
        if not missing:
            return
        reqs = [{"addSheet": {"properties": {"title": t}}} for t in missing]
        r = c.post(f"{base}:batchUpdate", headers=headers, json={"requests": reqs})
        if r.status_code == 404:
            raise SpreadsheetGone(spreadsheet_id)
        if r.status_code != 200:
            raise SheetsError(f"add tabs failed: {r.status_code} {r.text[:200]}")


# --- Row builders (generalize services/query.py: all rows, decimals kept) ----


def transactions_rows(db: Session, user_id: int) -> list[list]:
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.deleted_at.is_(None))
        .order_by(Transaction.occurred_at.desc())
        .all()
    )
    cats = {c.id: c.name for c in db.query(Category).filter_by(user_id=user_id).all()}
    srcs = {s.id: s.name for s in db.query(Source).filter_by(user_id=user_id).all()}
    z = tz()
    out: list[list] = [
        ["Date", "Time", "Type", "Category", "Amount", "Currency", "Source", "Description"]
    ]
    for r in rows:
        local = r.occurred_at.astimezone(z)
        out.append(
            [
                local.strftime("%Y-%m-%d"),
                local.strftime("%H:%M:%S"),
                "Expense" if r.type == "expense" else "Income",
                cats.get(r.category_id, ""),
                float(r.amount),
                r.currency,
                srcs.get(r.source_id, ""),
                r.description or "",
            ]
        )
    return out


def budgets_rows(db: Session, user_id: int) -> list[list]:
    cats = {c.id: c.name for c in db.query(Category).filter_by(user_id=user_id).all()}
    out: list[list] = [["Category", "MonthlyLimit", "Currency"]]
    for b in db.query(Budget).filter_by(user_id=user_id).all():
        out.append([cats.get(b.category_id, ""), float(b.monthly_limit), b.currency])
    return out


def wallets_rows(db: Session, user_id: int) -> list[list]:
    out: list[list] = [["Name", "Currency", "StartingBalance", "IsCredit", "Active"]]
    for s in db.query(Source).filter_by(user_id=user_id).all():
        out.append(
            [
                s.name,
                s.currency,
                float(s.starting_balance),
                "yes" if s.is_credit_card else "no",
                "yes" if s.active else "no",
            ]
        )
    return out


# --- Overview tab (mirrors the web dashboard) --------------------------------


def overview_rows(db: Session, user_id: int) -> tuple[list[list], dict]:
    """Build the 'Overview' tab (first sheet) plus a layout map the formatter
    styles against.

    Mirrors the web Overview — month totals, budget progress, the credit-card
    panel and account balances — in the user's reporting currency, so someone
    who lives in Sheets gets the same headline picture without opening the app.
    """
    # Imported lazily so this service carries no import-time dependency on the
    # API route modules (and is immune to FastAPI app-assembly ordering).
    from app.api.sources import _current_balance_map
    from app.api.stats import compute_overview

    user = db.get(User, user_id)
    if user is None:
        raise SheetsError(f"user {user_id} not found")
    ov = compute_overview(db, user)
    cur = ov["currency"]

    rows: list[list] = []
    layout: dict = {
        "width": 6,
        "money_pattern": _money_pattern(cur),
        "title_row": 0,
        "meta_rows": [],
        "section_rows": [],
        "table_headers": [],  # (row, ncols)
        "money_ranges": [],  # (col, start_row, end_row) — report currency
        "number_ranges": [],  # (col, start_row, end_row) — mixed currency
        "pct_ranges": [],  # (col, start_row, end_row)
        "status_range": None,  # (start_row, end_row, col)
    }

    def add(row: list) -> int:
        rows.append(row)
        return len(rows) - 1

    # Title block
    layout["title_row"] = add(["BudgetTracker — Overview"])
    month_label = date(ov["year"], ov["month"], 1).strftime("%B %Y")
    layout["meta_rows"].append(
        add([f"{month_label}   ·   Day {ov['today_day']} of {ov['days_in_month']}"])
    )
    updated = datetime.now(timezone.utc).astimezone(tz()).strftime("%Y-%m-%d %H:%M")
    layout["meta_rows"].append(add([f"Reporting in {cur}   ·   updated {updated}"]))
    add([""])

    # This month
    layout["section_rows"].append(add(["This month"]))
    t0 = len(rows)
    for label, key in (("Income", "income"), ("Expense", "expense"), ("Net", "net")):
        add([label, float(ov["totals"][key])])
    layout["money_ranges"].append((1, t0, len(rows)))
    add([""])

    # Budget progress
    layout["section_rows"].append(add(["Budget progress"]))
    if ov["budgets"]:
        layout["table_headers"].append(
            (add(["Category", "Limit", "Spent", "Remaining", "% Used", "Status"]), 6)
        )
        b0 = len(rows)
        for b in ov["budgets"]:
            add(
                [
                    b["category_name"],
                    float(b["limit"]),
                    float(b["spent"]),
                    float(b["remaining"]),
                    float(b["pct_used"]),
                    b["status"].replace("_", " ").capitalize(),
                ]
            )
        b1 = len(rows)
        for col in (1, 2, 3):
            layout["money_ranges"].append((col, b0, b1))
        layout["pct_ranges"].append((4, b0, b1))
        layout["status_range"] = (b0, b1, 5)
    else:
        add(["No budgets set yet."])
    add([""])

    # Credit card (only when the user actually has a credit-card source)
    has_cc = db.query(Source).filter_by(user_id=user_id, is_credit_card=True).first() is not None
    if has_cc:
        credit = ov["credit"]
        layout["section_rows"].append(add(["Credit card"]))
        c0 = len(rows)
        for label, key in (
            ("Outstanding", "outstanding"),
            ("Carried in", "carried"),
            ("Charges this month", "month_charges"),
            ("Payments this month", "month_payments"),
        ):
            add([label, float(credit[key])])
        layout["money_ranges"].append((1, c0, len(rows)))
        add([""])

    # Accounts (current balance, each in its own currency)
    layout["section_rows"].append(add(["Accounts"]))
    deltas = _current_balance_map(db, user_id)
    active = db.query(Source).filter_by(user_id=user_id, active=True).all()
    accounts = sorted(
        ((s, float(s.starting_balance + deltas.get(s.id, Decimal("0")))) for s in active),
        key=lambda t: t[1],
        reverse=True,
    )
    if accounts:
        layout["table_headers"].append((add(["Name", "Currency", "Current balance"]), 3))
        a0 = len(rows)
        for s, bal in accounts:
            name = f"{s.name}  (credit)" if s.is_credit_card else s.name
            add([name, s.currency, bal])
        layout["number_ranges"].append((2, a0, len(rows)))
    else:
        add(["No active accounts."])

    return rows, layout


# --- ChartData tab (hidden series for the Overview charts) --------------------
# Chart series palette — the same hues the web charts use, so the Sheets charts
# feel like the app. Income = gain green, expense = accent rust, etc.
_CHART_INCOME = "#2e7d4f"
_CHART_EXPENSE = "#c43d24"
_CHART_DAILY = "#3f8f57"
_CHART_BUDGET_LIMIT = "#9aa3b2"
_CHART_BUDGET_SPENT = "#a4512c"

# Cap categories like the web donut (top 10 by expense).
_CHART_TOP_CATEGORIES = 10


def chartdata_rows(db: Session, user_id: int) -> tuple[list[list], dict]:
    """Build the hidden 'ChartData' tab plus a layout the chart builder targets.

    Lays each chart's series in its own column block so their (variable) row
    counts never collide:  A:B category | D:F monthly | H:I daily | K:N budget.
    Reuses the same stats aggregations the web charts consume — no new math here.
    """
    from app.api.stats import categories_stats, compute_overview, daily, monthly

    user = db.get(User, user_id)
    if user is None:
        raise SheetsError(f"user {user_id} not found")

    now = datetime.now(timezone.utc).astimezone(tz())
    ov = compute_overview(db, user)
    cur = ov["currency"]

    # Category donut: top categories by expense this month.
    cats = categories_stats(
        user=user, db=db, from_=date(now.year, now.month, 1), to=now.date(), currency=cur
    )["categories"]
    cat_rows = [
        (c["category_name"], float(c["expense"]))
        for c in cats
        if float(c["expense"]) > 0
    ][:_CHART_TOP_CATEGORIES]

    # Monthly income vs expense: 12 rows, Jan..Dec.
    months = monthly(user=user, db=db, year=now.year, currency=cur)["months"]
    month_rows = [
        (date(now.year, r["month"], 1).strftime("%b"), float(r["income"]), float(r["expense"]))
        for r in months
    ]

    # Daily cumulative spend this month (running sum of expense, matches Daily.tsx).
    days = daily(user=user, db=db, year=now.year, month=now.month, currency=cur)["days"]
    cum = 0.0
    day_rows: list[tuple] = []
    for r in days:
        cum += float(r["expense"])
        day_rows.append((r["day"], round(cum, 2)))

    # Budget progress: limit vs spent per category (already computed in overview).
    budget_rows = [
        (b["category_name"], float(b["limit"]), float(b["spent"]), float(b["pct_used"]))
        for b in ov["budgets"]
    ]

    # Column blocks: (start_col, header_tuple, list_of_value_tuples).
    blocks = [
        (0, ("Category", "Spent"), cat_rows),
        (3, ("Month", "Income", "Expense"), month_rows),
        (7, ("Day", "Cumulative"), day_rows),
        (10, ("Category", "Limit", "Spent", "% Used"), budget_rows),
    ]

    width = 14  # A..N
    height = 1 + max((len(block[2]) for block in blocks), default=0)
    grid: list[list] = [["" for _ in range(width)] for _ in range(height)]
    for start_col, header, values in blocks:
        for j, head in enumerate(header):
            grid[0][start_col + j] = head
        for i, row in enumerate(values, start=1):
            for j, val in enumerate(row):
                grid[i][start_col + j] = val

    # r1 is the exclusive end-row (== endRowIndex). r1 == r0 → empty → chart skipped.
    chart_layout = {
        "currency": cur,
        "category": {"col0": 0, "header_row": 0, "r0": 1, "r1": 1 + len(cat_rows)},
        "monthly": {"col0": 3, "header_row": 0, "r0": 1, "r1": 1 + len(month_rows)},
        "daily": {"col0": 7, "header_row": 0, "r0": 1, "r1": 1 + len(day_rows)},
        "budget": {"col0": 10, "header_row": 0, "r0": 1, "r1": 1 + len(budget_rows)},
    }
    return grid, chart_layout


# --- Formatting (a second, non-values batchUpdate) ---------------------------

_DATA_TABS = {
    "Transactions": {"cols": 8, "money": [4]},
    "Budgets": {"cols": 3, "money": [1]},
    "Wallets": {"cols": 5, "money": [2]},
}


def _grid(sid: int, r0: int, r1: int, c0: int, c1: int) -> dict:
    return {
        "sheetId": sid,
        "startRowIndex": r0,
        "endRowIndex": r1,
        "startColumnIndex": c0,
        "endColumnIndex": c1,
    }


def _freeze_and_color(sid: int, edge: str, freeze: int = 1) -> dict:
    return {
        "updateSheetProperties": {
            "properties": {
                "sheetId": sid,
                "gridProperties": {"frozenRowCount": freeze},
                "tabColor": _rgb(edge),
            },
            "fields": "gridProperties.frozenRowCount,tabColor",
        }
    }


def _header_band(sid: int, ncols: int, edge: str) -> dict:
    return {
        "repeatCell": {
            "range": _grid(sid, 0, 1, 0, ncols),
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": _rgb(edge),
                    "textFormat": {"bold": True, "foregroundColor": _rgb(_WHITE)},
                    "verticalAlignment": "MIDDLE",
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
        }
    }


def _numfmt(sid: int, col: int, r0: int, r1: int, pattern: str, kind: str = "NUMBER") -> dict:
    return {
        "repeatCell": {
            "range": _grid(sid, r0, r1, col, col + 1),
            "cell": {"userEnteredFormat": {"numberFormat": {"type": kind, "pattern": pattern}}},
            "fields": "userEnteredFormat.numberFormat",
        }
    }


def _banding(sid: int, nrows: int, ncols: int, edge: str, band: str) -> dict:
    return {
        "addBanding": {
            "bandedRange": {
                "range": _grid(sid, 0, nrows, 0, ncols),
                "rowProperties": {
                    "headerColor": _rgb(edge),
                    "firstBandColor": _rgb(_WHITE),
                    "secondBandColor": _rgb(band),
                },
            }
        }
    }


def _autoresize(sid: int, ncols: int) -> dict:
    return {
        "autoResizeDimensions": {
            "dimensions": {
                "sheetId": sid,
                "dimension": "COLUMNS",
                "startIndex": 0,
                "endIndex": ncols,
            }
        }
    }


def _col_width(sid: int, c0: int, c1: int, px: int) -> dict:
    return {
        "updateDimensionProperties": {
            "range": {"sheetId": sid, "dimension": "COLUMNS", "startIndex": c0, "endIndex": c1},
            "properties": {"pixelSize": px},
            "fields": "pixelSize",
        }
    }


def _row_format(
    sid: int,
    row: int,
    ncols: int,
    *,
    bold: bool = False,
    size: int | None = None,
    italic: bool = False,
    bg: str | None = None,
    fg: str | None = None,
) -> dict:
    fmt: dict = {}
    fields: list[str] = []
    if bg is not None:
        fmt["backgroundColor"] = _rgb(bg)
        fields.append("backgroundColor")
    tf: dict = {}
    if bold:
        tf["bold"] = True
    if italic:
        tf["italic"] = True
    if size is not None:
        tf["fontSize"] = size
    if fg is not None:
        tf["foregroundColor"] = _rgb(fg)
    if tf:
        fmt["textFormat"] = tf
        fields.append("textFormat")
    return {
        "repeatCell": {
            "range": _grid(sid, row, row + 1, 0, ncols),
            "cell": {"userEnteredFormat": fmt},
            "fields": "userEnteredFormat(" + ",".join(fields) + ")",
        }
    }


def _status_rule(sid: int, r0: int, r1: int, col: int, text: str, bg: str) -> dict:
    return {
        "addConditionalFormatRule": {
            "rule": {
                "ranges": [_grid(sid, r0, r1, col, col + 1)],
                "booleanRule": {
                    "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": text}]},
                    "format": {"backgroundColor": _rgb(bg)},
                },
            },
            "index": 0,
        }
    }


def _overview_requests(sid: int, lay: dict) -> list[dict]:
    w = lay["width"]
    reqs: list[dict] = [_freeze_and_color(sid, _TAB_EDGE["Overview"], freeze=3)]
    reqs.append(_row_format(sid, lay["title_row"], w, bold=True, size=15, fg=_INK))
    for r in lay["meta_rows"]:
        reqs.append(_row_format(sid, r, w, italic=True, size=9, fg=_MUTE))
    for r in lay["section_rows"]:
        reqs.append(_row_format(sid, r, w, bold=True, size=11, bg=_SECTION_WASH, fg=_INK))
    for row, ncols in lay["table_headers"]:
        reqs.append(_row_format(sid, row, ncols, bold=True, bg=_TAB_EDGE["Overview"], fg=_WHITE))
    for col, r0, r1 in lay["money_ranges"]:
        reqs.append(_numfmt(sid, col, r0, r1, lay["money_pattern"]))
    for col, r0, r1 in lay["number_ranges"]:
        reqs.append(_numfmt(sid, col, r0, r1, _MONEY_MIXED))
    for col, r0, r1 in lay["pct_ranges"]:
        reqs.append(_numfmt(sid, col, r0, r1, "0%", kind="PERCENT"))
    if lay["status_range"]:
        r0, r1, col = lay["status_range"]
        for text, bg in _STATUS_BG.items():
            reqs.append(_status_rule(sid, r0, r1, col, text, bg))
    reqs.append(_col_width(sid, 0, 1, 190))
    reqs.append(_col_width(sid, 1, w, 110))
    return reqs


# --- Native Overview charts (bound to the hidden ChartData ranges) -----------


def _chart_position(ov_sid: int, anchor_row: int, anchor_col: int = 8) -> dict:
    """Float a chart over the Overview tab to the right of the dashboard tables."""
    return {
        "overlayPosition": {
            "anchorCell": {"sheetId": ov_sid, "rowIndex": anchor_row, "columnIndex": anchor_col},
            "offsetXPixels": 8,
            "offsetYPixels": 8,
            "widthPixels": 600,
            "heightPixels": 360,
        }
    }


def _src(data_sid: int, block: dict, c0: int, c1: int) -> dict:
    """A source range over ChartData spanning the header row through the data."""
    return {"sourceRange": {"sources": [_grid(data_sid, block["header_row"], block["r1"], c0, c1)]}}


def _basic_series(data_sid: int, block: dict, col: int, color: str, axis: str = "LEFT_AXIS") -> dict:
    return {
        "series": _src(data_sid, block, col, col + 1),
        "targetAxis": axis,
        "colorStyle": {"rgbColor": _rgb(color)},
    }


def build_chart_requests(data_sid: int, ov_sid: int, chart_layout: dict) -> list[dict]:
    """addChart requests for the four Overview charts, skipping empty series.

    Mirrors the web app: category donut, monthly income/expense columns, daily
    cumulative-spend line, budget limit-vs-spent bars. Each binds to a column
    block in the hidden ChartData tab (header row included as the series title).
    """
    if not chart_layout:
        return []
    cur = chart_layout.get("currency", "")
    reqs: list[dict] = []

    cat = chart_layout["category"]
    if cat["r1"] > cat["r0"]:
        c0 = cat["col0"]
        reqs.append(
            {
                "addChart": {
                    "chart": {
                        "spec": {
                            "title": "Spending by category",
                            "pieChart": {
                                "legendPosition": "RIGHT_LEGEND",
                                "threeDimensional": False,
                                "pieHole": 0.5,
                                "domain": _src(data_sid, cat, c0, c0 + 1),
                                "series": _src(data_sid, cat, c0 + 1, c0 + 2),
                            },
                        },
                        "position": _chart_position(ov_sid, 1),
                    }
                }
            }
        )

    mon = chart_layout["monthly"]
    if mon["r1"] > mon["r0"]:
        c0 = mon["col0"]
        reqs.append(
            {
                "addChart": {
                    "chart": {
                        "spec": {
                            "title": "Income vs expense by month",
                            "basicChart": {
                                "chartType": "COLUMN",
                                "legendPosition": "BOTTOM_LEGEND",
                                "headerCount": 1,
                                "axis": [
                                    {"position": "BOTTOM_AXIS", "title": "Month"},
                                    {"position": "LEFT_AXIS", "title": cur},
                                ],
                                "domains": [{"domain": _src(data_sid, mon, c0, c0 + 1)}],
                                "series": [
                                    _basic_series(data_sid, mon, c0 + 1, _CHART_INCOME),
                                    _basic_series(data_sid, mon, c0 + 2, _CHART_EXPENSE),
                                ],
                            },
                        },
                        "position": _chart_position(ov_sid, 20),
                    }
                }
            }
        )

    day = chart_layout["daily"]
    if day["r1"] > day["r0"]:
        c0 = day["col0"]
        reqs.append(
            {
                "addChart": {
                    "chart": {
                        "spec": {
                            "title": "Cumulative spend this month",
                            "basicChart": {
                                "chartType": "LINE",
                                "legendPosition": "NO_LEGEND",
                                "headerCount": 1,
                                "axis": [
                                    {"position": "BOTTOM_AXIS", "title": "Day"},
                                    {"position": "LEFT_AXIS", "title": cur},
                                ],
                                "domains": [{"domain": _src(data_sid, day, c0, c0 + 1)}],
                                "series": [_basic_series(data_sid, day, c0 + 1, _CHART_DAILY)],
                            },
                        },
                        "position": _chart_position(ov_sid, 39),
                    }
                }
            }
        )

    bud = chart_layout["budget"]
    if bud["r1"] > bud["r0"]:
        c0 = bud["col0"]
        reqs.append(
            {
                "addChart": {
                    "chart": {
                        "spec": {
                            "title": "Budget progress",
                            "basicChart": {
                                "chartType": "BAR",
                                "legendPosition": "BOTTOM_LEGEND",
                                "headerCount": 1,
                                "axis": [
                                    {"position": "LEFT_AXIS", "title": "Category"},
                                    {"position": "BOTTOM_AXIS", "title": cur},
                                ],
                                "domains": [{"domain": _src(data_sid, bud, c0, c0 + 1)}],
                                "series": [
                                    _basic_series(data_sid, bud, c0 + 1, _CHART_BUDGET_LIMIT),
                                    _basic_series(data_sid, bud, c0 + 2, _CHART_BUDGET_SPENT),
                                ],
                            },
                        },
                        "position": _chart_position(ov_sid, 58),
                    }
                }
            }
        )

    return reqs


def build_format_requests(
    sheets: list[dict],
    tabs: dict[str, list[list]],
    overview_layout: dict,
    chart_layout: dict | None = None,
) -> list[dict]:
    """Pure builder: turn the spreadsheet's current sheet metadata into the
    ordered ``:batchUpdate`` request list. Deletes of prior banding/conditional
    rules always come first so re-runs stay idempotent. No network — unit-tested
    against mocked metadata."""
    sid_by_title: dict[str, int] = {}
    reqs: list[dict] = []
    # 1) clear prior banding, conditional rules, and embedded charts. Conditionals
    #    go by reverse index; charts/bandings by id. All deletes precede every add
    #    so hourly re-runs never accumulate styling or duplicate charts.
    for sh in sheets:
        props = sh["properties"]
        sid_by_title[props["title"]] = props["sheetId"]
        for b in sh.get("bandedRanges", []) or []:
            reqs.append({"deleteBanding": {"bandedRangeId": b["bandedRangeId"]}})
        n_cf = len(sh.get("conditionalFormats", []) or [])
        for idx in range(n_cf - 1, -1, -1):
            reqs.append(
                {"deleteConditionalFormatRule": {"sheetId": props["sheetId"], "index": idx}}
            )
        for ch in sh.get("charts", []) or []:
            if "chartId" in ch:
                reqs.append({"deleteEmbeddedObject": {"objectId": ch["chartId"]}})
    # 2) data tabs
    for title, spec in _DATA_TABS.items():
        sid = sid_by_title.get(title)
        if sid is None:
            continue
        nrows = len(tabs.get(title, []))
        ncols = spec["cols"]
        edge = _TAB_EDGE[title]
        reqs.append(_freeze_and_color(sid, edge))
        reqs.append(_header_band(sid, ncols, edge))
        if nrows >= 2:
            reqs.append(_banding(sid, nrows, ncols, edge, _TAB_BAND[title]))
            for col in spec["money"]:
                reqs.append(_numfmt(sid, col, 1, nrows, _MONEY_MIXED))
        reqs.append(_autoresize(sid, ncols))
    # 3) overview tab
    ov_sid = sid_by_title.get("Overview")
    if ov_sid is not None and overview_layout:
        reqs.extend(_overview_requests(ov_sid, overview_layout))
    # 4) Overview charts, bound to the hidden ChartData ranges
    data_sid = sid_by_title.get(CHART_DATA_TAB)
    if data_sid is not None and ov_sid is not None and chart_layout:
        reqs.extend(build_chart_requests(data_sid, ov_sid, chart_layout))
        # Keep the helper tab out of the way (idempotent — safe to reissue).
        reqs.append(
            {
                "updateSheetProperties": {
                    "properties": {"sheetId": data_sid, "hidden": True},
                    "fields": "hidden",
                }
            }
        )
    return reqs


def format_workbook(
    access_token: str,
    spreadsheet_id: str,
    tabs: dict[str, list[list]],
    overview_layout: dict,
    chart_layout: dict | None = None,
) -> None:
    """Style the workbook with a second, non-values ``:batchUpdate``.

    Idempotent across the hourly full re-write: existing bandings, conditional
    rules and embedded charts are deleted before fresh ones are added, so they
    never accumulate. Best-effort — the caller keeps the sync green even if
    styling fails, since the data itself is already written.
    """
    headers = _auth_headers(access_token)
    base = f"{SHEETS_API}/{spreadsheet_id}"
    fields = (
        "sheets(properties(sheetId,title,hidden),"
        "bandedRanges(bandedRangeId),conditionalFormats,charts(chartId))"
    )
    with httpx.Client(timeout=30.0) as c:
        meta = c.get(base, headers=headers, params={"fields": fields})
        if meta.status_code == 404:
            raise SpreadsheetGone(spreadsheet_id)
        if meta.status_code != 200:
            raise SheetsError(f"meta failed: {meta.status_code} {meta.text[:200]}")
        reqs = build_format_requests(
            meta.json().get("sheets", []), tabs, overview_layout, chart_layout
        )
        if reqs:
            r = c.post(f"{base}:batchUpdate", headers=headers, json={"requests": reqs})
            if r.status_code == 404:
                raise SpreadsheetGone(spreadsheet_id)
            if r.status_code != 200:
                raise SheetsError(f"format failed: {r.status_code} {r.text[:200]}")


# --- Sync orchestration ------------------------------------------------------


def sync_user(db: Session, cred: GoogleCredential) -> None:
    """Full re-write of one user's workbook. Caller commits."""
    access = google_oauth.refresh_access_token(google_oauth.decrypt_token(cred.refresh_token_enc))
    user = db.get(User, cred.user_id)
    title = f"BudgetTracker — {user.username}" if user else "BudgetTracker"
    ov_rows, ov_layout = overview_rows(db, cred.user_id)
    cd_rows, chart_layout = chartdata_rows(db, cred.user_id)
    tabs = {
        "Overview": ov_rows,
        "Transactions": transactions_rows(db, cred.user_id),
        "Budgets": budgets_rows(db, cred.user_id),
        "Wallets": wallets_rows(db, cred.user_id),
        CHART_DATA_TAB: cd_rows,
    }
    sid = cred.spreadsheet_id
    if not sid:
        sid, cred.spreadsheet_url = create_spreadsheet(access, title)
        cred.spreadsheet_id = sid
    try:
        # Legacy workbooks predate the ChartData tab — add it before writing it.
        ensure_tabs(access, sid, TAB_TITLES)
        write_workbook(access, sid, tabs)
    except SpreadsheetGone:
        # User deleted the sheet — recreate and write afresh.
        sid, cred.spreadsheet_url = create_spreadsheet(access, title)
        cred.spreadsheet_id = sid
        write_workbook(access, sid, tabs)
    # Styling + charts are best-effort: the data is already written, so a
    # formatting hiccup must not fail the sync or trip the dashboard's banner.
    try:
        format_workbook(access, sid, tabs, ov_layout, chart_layout)
    except Exception as e:  # noqa: BLE001
        log.warning("sheets formatting skipped for user %s: %s", cred.user_id, e)
    cred.last_synced_at = datetime.now(timezone.utc)
    cred.last_sync_error = None


def sync_all(db: Session | None = None) -> int:
    """Hourly scheduler job: re-write every opted-in user's workbook.

    Per-user errors are isolated and recorded on the row so one bad account
    doesn't abort the batch (mirrors daily_summary.refresh_all).
    """
    s = get_settings()
    if not (s.google_client_id and s.google_sheets_redirect_uri):
        return 0
    own_session = db is None
    if own_session:
        db = SessionLocal()
    count = 0
    try:
        creds = db.query(GoogleCredential).filter_by(auto_sync=True).all()
        for cred in creds:
            try:
                sync_user(db, cred)
                db.commit()
                count += 1
            except Exception as e:  # noqa: BLE001
                db.rollback()
                row = db.get(GoogleCredential, cred.user_id)
                if row is not None:
                    row.last_sync_error = str(e)[:500]
                    db.commit()
                log.warning("sheets sync failed for user %s: %s", cred.user_id, e)
    finally:
        if own_session:
            db.close()
    return count
