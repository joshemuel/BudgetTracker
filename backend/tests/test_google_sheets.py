"""Tests for the Google Sheets sync service (no network)."""

from sqlalchemy.orm import Session

from app.db.models import User
from app.services import google_oauth, google_sheets

TX_HEADER = ["Date", "Time", "Type", "Category", "Amount", "Currency", "Source", "Description"]
BUDGET_HEADER = ["Category", "MonthlyLimit", "Currency"]
WALLET_HEADER = ["Name", "Currency", "StartingBalance", "IsCredit", "Active"]


def test_refresh_token_encrypt_decrypt_roundtrip():
    token = "1//0gSecretRefreshTokenValue-abc_123"
    enc = google_oauth.encrypt_token(token)
    assert enc != token  # actually encrypted, not stored in clear
    assert google_oauth.decrypt_token(enc) == token


def _seed_user(db: Session) -> User:
    return db.query(User).filter_by(username="josia").one()


def test_transactions_rows_header_and_shape(db: Session):
    user = _seed_user(db)
    rows = google_sheets.transactions_rows(db, user.id)
    assert rows[0] == TX_HEADER
    assert all(len(r) == len(TX_HEADER) for r in rows)
    # Amount column is numeric (decimals preserved as float), not a formatted string.
    assert all(isinstance(r[4], (int, float)) for r in rows[1:])


def test_budgets_and_wallets_headers(db: Session):
    user = _seed_user(db)
    budgets = google_sheets.budgets_rows(db, user.id)
    wallets = google_sheets.wallets_rows(db, user.id)
    assert budgets[0] == BUDGET_HEADER
    assert wallets[0] == WALLET_HEADER
    assert all(len(r) == len(BUDGET_HEADER) for r in budgets)
    assert all(len(r) == len(WALLET_HEADER) for r in wallets)


def test_status_requires_auth(client):
    # Unauthenticated callers get 401 from the get_current_user dependency.
    assert client.get("/sheets/status").status_code == 401


def test_overview_tab_leads_and_mirrors_route(db: Session):
    from app.api.stats import compute_overview

    user = _seed_user(db)
    # Overview must be the first tab so a Sheets-first user lands on the dashboard.
    assert google_sheets.TAB_TITLES[0] == "Overview"

    rows, layout = google_sheets.overview_rows(db, user.id)
    assert rows[0][0] == "BudgetTracker — Overview"
    # Layout indices stay inside the rows it describes.
    for r in layout["section_rows"] + [t[0] for t in layout["table_headers"]]:
        assert 0 <= r < len(rows)
    for _col, r0, r1 in layout["money_ranges"] + layout["number_ranges"] + layout["pct_ranges"]:
        assert 0 <= r0 <= r1 <= len(rows)

    # Headline totals match the API the web Overview consumes (same source of truth).
    ov = compute_overview(db, user)
    flat = [c for row in rows for c in row]
    assert float(ov["totals"]["income"]) in flat
    assert float(ov["totals"]["net"]) in flat


def test_format_requests_are_idempotent():
    # Two prior bandings + three prior conditional rules must be deleted before
    # any fresh formatting is added, so hourly re-runs don't accumulate styling.
    sheets = [
        {
            "properties": {"sheetId": 0, "title": "Overview"},
            "bandedRanges": [],
            "conditionalFormats": [{}, {}, {}],
        },
        {
            "properties": {"sheetId": 1, "title": "Transactions"},
            "bandedRanges": [{"bandedRangeId": 77}, {"bandedRangeId": 78}],
            "conditionalFormats": [],
        },
    ]
    tabs = {"Overview": [["x"]], "Transactions": [["h"], ["a"], ["b"]]}
    layout = {
        "width": 6,
        "money_pattern": "#,##0",
        "title_row": 0,
        "meta_rows": [],
        "section_rows": [],
        "table_headers": [],
        "money_ranges": [],
        "number_ranges": [],
        "pct_ranges": [],
        "status_range": None,
    }
    reqs = google_sheets.build_format_requests(sheets, tabs, layout)
    kinds = [next(iter(r)) for r in reqs]
    deletes = [k for k in kinds if k.startswith("delete")]
    assert kinds.count("deleteBanding") == 2
    assert kinds.count("deleteConditionalFormatRule") == 3
    # Every delete precedes every add.
    last_delete = max(i for i, k in enumerate(kinds) if k in deletes)
    first_add = min(i for i, k in enumerate(kinds) if not k.startswith("delete"))
    assert last_delete < first_add


def test_chartdata_tab_managed_and_hidden():
    # ChartData is a managed tab (created/cleared/rewritten each sync) and is the
    # source the Overview charts bind to — it must be hidden from the user.
    assert google_sheets.CHART_DATA_TAB in google_sheets.TAB_TITLES
    assert google_sheets.TAB_TITLES[0] == "Overview"  # dashboard still leads


def test_chartdata_rows_shape(db: Session):
    user = _seed_user(db)
    grid, layout = google_sheets.chartdata_rows(db, user.id)
    assert layout["category"]["col0"] == 0
    assert layout["monthly"]["col0"] == 3
    assert layout["daily"]["col0"] == 7
    assert layout["budget"]["col0"] == 10
    # Headers sit on the documented row/column.
    assert grid[0][0] == "Category"
    assert grid[0][3] == "Month"
    assert grid[0][7] == "Day"
    assert grid[0][10] == "Category"
    # Monthly is always 12 rows; ranges stay inside the grid and r0 <= r1.
    assert layout["monthly"]["r1"] - layout["monthly"]["r0"] == 12
    for key in ("category", "monthly", "daily", "budget"):
        block = layout[key]
        assert 0 <= block["r0"] <= block["r1"] <= len(grid)
    # All four expense bars in the budget block are floats (parseable numbers).
    bud = layout["budget"]
    for r in range(bud["r0"], bud["r1"]):
        assert isinstance(grid[r][bud["col0"] + 1], float)  # limit


def test_chart_requests_built_and_skipped():
    full = {
        "currency": "IDR",
        "category": {"col0": 0, "header_row": 0, "r0": 1, "r1": 4},
        "monthly": {"col0": 3, "header_row": 0, "r0": 1, "r1": 13},
        "daily": {"col0": 7, "header_row": 0, "r0": 1, "r1": 31},
        "budget": {"col0": 10, "header_row": 0, "r0": 1, "r1": 1},  # empty → skipped
    }
    reqs = google_sheets.build_chart_requests(data_sid=4, ov_sid=0, chart_layout=full)
    assert all(next(iter(r)) == "addChart" for r in reqs)
    assert len(reqs) == 3  # budget skipped (r0 == r1)
    specs = [r["addChart"]["chart"]["spec"] for r in reqs]
    assert "pieChart" in specs[0]
    assert specs[1]["basicChart"]["chartType"] == "COLUMN"
    assert specs[2]["basicChart"]["chartType"] == "LINE"
    # Empty layout → no charts.
    assert google_sheets.build_chart_requests(4, 0, {}) == []


def test_format_requests_delete_prior_charts_before_adding():
    # A pre-existing chart on Overview must be deleted before fresh charts are
    # added, with all deletes still preceding every add.
    sheets = [
        {
            "properties": {"sheetId": 0, "title": "Overview"},
            "bandedRanges": [],
            "conditionalFormats": [],
            "charts": [{"chartId": 501}, {"chartId": 502}],
        },
        {"properties": {"sheetId": 4, "title": google_sheets.CHART_DATA_TAB}},
    ]
    tabs = {"Overview": [["x"]], google_sheets.CHART_DATA_TAB: [["Category", "Spent"]]}
    layout = {
        "width": 6,
        "money_pattern": "#,##0",
        "title_row": 0,
        "meta_rows": [],
        "section_rows": [],
        "table_headers": [],
        "money_ranges": [],
        "number_ranges": [],
        "pct_ranges": [],
        "status_range": None,
    }
    chart_layout = {
        "currency": "IDR",
        "category": {"col0": 0, "header_row": 0, "r0": 1, "r1": 3},
        "monthly": {"col0": 3, "header_row": 0, "r0": 1, "r1": 13},
        "daily": {"col0": 7, "header_row": 0, "r0": 1, "r1": 1},
        "budget": {"col0": 10, "header_row": 0, "r0": 1, "r1": 1},
    }
    reqs = google_sheets.build_format_requests(sheets, tabs, layout, chart_layout)
    kinds = [next(iter(r)) for r in reqs]
    assert kinds.count("deleteEmbeddedObject") == 2
    assert kinds.count("addChart") == 2  # category + monthly (daily/budget empty)
    last_delete = max(i for i, k in enumerate(kinds) if k.startswith("delete"))
    first_add = min(i for i, k in enumerate(kinds) if not k.startswith("delete"))
    assert last_delete < first_add
    # ChartData tab is hidden.
    assert any(
        k == "updateSheetProperties"
        and r["updateSheetProperties"]["properties"].get("hidden") is True
        for k, r in zip(kinds, reqs)
    )
