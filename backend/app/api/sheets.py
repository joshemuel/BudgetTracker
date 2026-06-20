"""Google Sheets connection + sync endpoints.

Connecting is a SEPARATE incremental OAuth grant from login (it needs the
drive.file scope + offline access for a refresh token). Connecting = opting in;
auto-sync defaults on and is refreshed hourly by the scheduler. Manual "Sync
now", an auto-sync toggle, and disconnect are also exposed.
"""

import logging

from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.config import get_settings
from app.db.models import GoogleCredential, User
from app.schemas.sheets import AutoSyncUpdate, SheetsStatusOut
from app.services import google_oauth, google_sheets

router = APIRouter(prefix="/sheets", tags=["sheets"])
log = logging.getLogger(__name__)

SHEETS_STATE_COOKIE = "sheets_oauth_state"


def _enabled() -> bool:
    s = get_settings()
    return bool(s.google_client_id and s.google_sheets_redirect_uri)


def _frontend_redirect(path: str) -> RedirectResponse:
    base = get_settings().frontend_base_url.rstrip("/")
    return RedirectResponse(f"{base}{path}" if base else path, status_code=302)


def _status(cred: GoogleCredential | None) -> SheetsStatusOut:
    if cred is None:
        return SheetsStatusOut(connected=False)
    return SheetsStatusOut(
        connected=True,
        google_email=cred.google_email,
        auto_sync=cred.auto_sync,
        spreadsheet_url=cred.spreadsheet_url,
        last_synced_at=cred.last_synced_at,
        last_sync_error=cred.last_sync_error,
    )


@router.get("/status", response_model=SheetsStatusOut)
def sheets_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _enabled():
        return SheetsStatusOut(connected=False)
    return _status(db.get(GoogleCredential, user.id))


@router.get("/connect")
def connect(user: User = Depends(get_current_user)):
    s = get_settings()
    if not _enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google Sheets sync is not configured")
    state = google_oauth.make_state()
    resp = RedirectResponse(google_oauth.sheets_authorize_url(state), status_code=302)
    resp.set_cookie(
        SHEETS_STATE_COOKIE,
        state,
        max_age=google_oauth.STATE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=s.session_cookie_secure,
        path="/",
    )
    return resp


@router.get("/callback")
def callback(
    code: str | None = None,
    state: str | None = None,
    sheets_state: str | None = Cookie(default=None, alias=SHEETS_STATE_COOKIE),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    s = get_settings()
    if not _enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google Sheets sync is not configured")
    if (
        not code
        or not state
        or not sheets_state
        or state != sheets_state
        or not google_oauth.verify_state(state)
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid OAuth state")
    try:
        tokens = google_oauth.exchange_code(code, redirect_uri=s.google_sheets_redirect_uri)
    except google_oauth.OAuthError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google authorization failed")

    refresh = tokens.get("refresh_token")
    if not refresh:
        # Without offline consent Google omits the refresh token; prompt=consent
        # should prevent this, but surface a clear retry message if it happens.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Google did not return a refresh token. Please try connecting again.",
        )

    email = None
    try:
        claims = google_oauth.decode_id_token(tokens.get("id_token"))
        email = (claims.get("email") or "").lower() or None
    except google_oauth.OAuthError:
        pass

    cred = db.get(GoogleCredential, user.id)
    if cred is None:
        cred = GoogleCredential(user_id=user.id)
        db.add(cred)
    cred.refresh_token_enc = google_oauth.encrypt_token(refresh)
    cred.google_email = email
    cred.scopes = tokens.get("scope", google_oauth.SHEETS_SCOPE)
    cred.auto_sync = True
    db.flush()

    # First sync immediately so the user sees a populated sheet right away.
    try:
        google_sheets.sync_user(db, cred)
    except Exception as e:  # noqa: BLE001
        cred.last_sync_error = str(e)[:500]
        log.warning("initial sheets sync failed for user %s: %s", user.id, e)
    db.commit()

    resp = _frontend_redirect("/settings/account?sheets=connected")
    resp.delete_cookie(SHEETS_STATE_COOKIE)
    return resp


@router.post("/sync", response_model=SheetsStatusOut)
def sync_now(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cred = db.get(GoogleCredential, user.id)
    if cred is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google Sheets is not connected")
    try:
        google_sheets.sync_user(db, cred)
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        cred = db.get(GoogleCredential, user.id)
        if cred is not None:
            cred.last_sync_error = str(e)[:500]
            db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Sync failed: {e}")
    return _status(cred)


@router.patch("", response_model=SheetsStatusOut)
def update_settings(
    payload: AutoSyncUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cred = db.get(GoogleCredential, user.id)
    if cred is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google Sheets is not connected")
    cred.auto_sync = payload.auto_sync
    db.commit()
    return _status(cred)


@router.post("/disconnect", status_code=status.HTTP_204_NO_CONTENT)
def disconnect(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cred = db.get(GoogleCredential, user.id)
    if cred is not None:
        try:
            google_oauth.revoke_token(google_oauth.decrypt_token(cred.refresh_token_enc))
        except Exception:  # noqa: BLE001
            pass
        db.delete(cred)
        db.commit()
