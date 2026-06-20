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
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Budget, Category, GoogleCredential, Source, Transaction, User
from app.db.session import SessionLocal
from app.services import google_oauth
from app.services.parse import tz

log = logging.getLogger(__name__)

SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"
TAB_TITLES = ["Transactions", "Budgets", "Wallets"]


class SheetsError(Exception):
    """Any failure talking to the Google Sheets API."""


class SpreadsheetGone(SheetsError):
    """The stored spreadsheet no longer exists (user deleted it) — recreate it."""


def _auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


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


# --- Sync orchestration ------------------------------------------------------


def sync_user(db: Session, cred: GoogleCredential) -> None:
    """Full re-write of one user's workbook. Caller commits."""
    access = google_oauth.refresh_access_token(google_oauth.decrypt_token(cred.refresh_token_enc))
    user = db.get(User, cred.user_id)
    title = f"BudgetTracker — {user.username}" if user else "BudgetTracker"
    tabs = {
        "Transactions": transactions_rows(db, cred.user_id),
        "Budgets": budgets_rows(db, cred.user_id),
        "Wallets": wallets_rows(db, cred.user_id),
    }
    sid = cred.spreadsheet_id
    if not sid:
        sid, cred.spreadsheet_url = create_spreadsheet(access, title)
        cred.spreadsheet_id = sid
    try:
        write_workbook(access, sid, tabs)
    except SpreadsheetGone:
        # User deleted the sheet — recreate and write afresh.
        sid, cred.spreadsheet_url = create_spreadsheet(access, title)
        cred.spreadsheet_id = sid
        write_workbook(access, sid, tabs)
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
