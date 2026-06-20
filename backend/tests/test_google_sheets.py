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
