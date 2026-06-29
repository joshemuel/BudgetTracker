import re
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import SESSION_COOKIE, get_current_user, get_db
from app.config import get_settings
from app.db.models import Budget, CurrencySourceDefault, SessionToken, Source, User
from app.schemas.auth import (
    ChangePasswordRequest,
    ChangeUsernameRequest,
    LoginRequest,
    UserOut,
    UserPreferencesUpdate,
)
from app.services import fx, google_oauth, provisioning
from app.services.auth import SESSION_TTL, create_session, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

OAUTH_STATE_COOKIE = "oauth_state"


def _frontend_redirect(path: str) -> RedirectResponse:
    base = get_settings().frontend_base_url.rstrip("/")
    return RedirectResponse(f"{base}{path}" if base else path, status_code=302)


def _unique_username(db: Session, name: str, email: str | None) -> str:
    seed = name or (email.split("@")[0] if email else "")
    base = re.sub(r"[^a-z0-9]+", "", seed.lower())[:40] or "user"
    candidate = base
    n = 1
    while db.query(User).filter_by(username=candidate).one_or_none() is not None:
        n += 1
        candidate = f"{base}{n}"
    return candidate


def _round_currency(amount: Decimal, currency: str) -> Decimal:
    if currency in {"IDR", "JPY"}:
        return amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _set_currency_default_source(db: Session, user: User, source: Source) -> None:
    currency = (source.currency or user.default_currency or "IDR").upper()
    row = (
        db.query(CurrencySourceDefault)
        .filter_by(user_id=user.id, currency=currency)
        .one_or_none()
    )
    if row is None:
        db.add(
            CurrencySourceDefault(
                user_id=user.id,
                currency=currency,
                source_id=source.id,
            )
        )
    else:
        row.source_id = source.id


@router.post("/login", response_model=UserOut)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(username=payload.username).one_or_none()
    if user is None or not user.password_hash or not verify_password(
        payload.password, user.password_hash
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if user.status != "approved":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is pending approval")
    token = create_session(db, user)
    db.commit()
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token.token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=get_settings().session_cookie_secure,
    )
    return user


@router.get("/config")
def auth_config():
    """Public: lets the login page know whether to show the Google button."""
    s = get_settings()
    return {"google_enabled": bool(s.google_client_id and s.google_redirect_uri)}


@router.get("/google/login")
def google_login():
    s = get_settings()
    if not s.google_client_id or not s.google_redirect_uri:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google sign-in is not configured")
    state = google_oauth.make_state()
    resp = RedirectResponse(google_oauth.authorize_url(state), status_code=302)
    resp.set_cookie(
        OAUTH_STATE_COOKIE,
        state,
        max_age=google_oauth.STATE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=s.session_cookie_secure,
        path="/",
    )
    return resp


@router.get("/google/callback")
def google_callback(
    code: str | None = None,
    state: str | None = None,
    oauth_state: str | None = Cookie(default=None, alias=OAUTH_STATE_COOKIE),
    db: Session = Depends(get_db),
):
    s = get_settings()
    if not s.google_client_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Google sign-in is not configured")
    # CSRF: the state must be present, match the cookie, and carry a valid signature.
    if (
        not code
        or not state
        or not oauth_state
        or state != oauth_state
        or not google_oauth.verify_state(state)
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid OAuth state")
    try:
        tokens = google_oauth.exchange_code(code)
        claims = google_oauth.decode_id_token(tokens.get("id_token"))
    except google_oauth.OAuthError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google sign-in failed")

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google did not return an account id")
    email = (claims.get("email") or "").lower() or None
    email_verified = bool(claims.get("email_verified"))
    name = claims.get("name") or claims.get("given_name") or ""

    user = db.query(User).filter_by(google_sub=sub).one_or_none()
    # Link to a pre-existing account only on a *verified* matching email.
    if user is None and email and email_verified:
        existing = db.query(User).filter_by(email=email).one_or_none()
        if existing is not None and existing.google_sub is None:
            existing.google_sub = sub
            user = existing

    if user is None:
        # Avoid colliding with an email already on another account.
        create_email = email
        if create_email and db.query(User).filter_by(email=create_email).one_or_none() is not None:
            create_email = None
        user = User(
            username=_unique_username(db, name, email),
            email=create_email,
            google_sub=sub,
            password_hash=None,
            status="pending",
            is_admin=False,
        )
        db.add(user)
        db.flush()
        provisioning.seed_new_user_defaults(db, user)

    if user.status != "approved":
        db.commit()
        return _frontend_redirect("/pending")

    token = create_session(db, user)
    db.commit()
    resp = _frontend_redirect("/")
    resp.set_cookie(
        SESSION_COOKIE,
        token.token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=s.session_cookie_secure,
    )
    resp.delete_cookie(OAUTH_STATE_COOKIE)
    return resp


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(SessionToken).filter_by(user_id=user.id).delete()
    db.commit()
    response.delete_cookie(SESSION_COOKIE)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UserPreferencesUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if "default_currency" in payload.model_fields_set and payload.default_currency is not None:
        cur = payload.default_currency.upper()
        if cur not in {"IDR", "SGD", "JPY", "AUD", "TWD"}:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported currency")
        prev = (user.default_currency or "IDR").upper()
        if cur != prev:
            rates = fx.get_rates_cached(db)
            budgets = db.query(Budget).filter_by(user_id=user.id).all()
            for b in budgets:
                converted = fx.convert(Decimal(b.monthly_limit), b.currency or prev, cur, rates)
                b.monthly_limit = _round_currency(converted, cur)
                b.currency = cur
        user.default_currency = cur

    if "default_expense_source_id" in payload.model_fields_set:
        if payload.default_expense_source_id is None:
            user.default_expense_source_id = None
        else:
            src = (
                db.query(Source)
                .filter_by(id=payload.default_expense_source_id, user_id=user.id, active=True)
                .one_or_none()
            )
            if src is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown source")
            user.default_expense_source_id = src.id
            _set_currency_default_source(db, user, src)

    if "sources_enabled" in payload.model_fields_set and payload.sources_enabled is not None:
        user.sources_enabled = payload.sources_enabled

    if "theme_skin" in payload.model_fields_set and payload.theme_skin is not None:
        if payload.theme_skin not in {"editorial", "pastel"}:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown theme skin")
        user.theme_skin = payload.theme_skin

    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user.password_hash or not verify_password(
        payload.current_password, user.password_hash
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be at least 8 characters")
    user.password_hash = hash_password(payload.new_password)
    db.query(SessionToken).filter_by(user_id=user.id).delete()
    db.commit()
    response.delete_cookie(SESSION_COOKIE)


@router.post("/change-username", response_model=UserOut)
def change_username(
    payload: ChangeUsernameRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Stored lowercase (matching the OAuth provisioning convention in
    # _unique_username), with the charset widened to allow . _ - separators.
    candidate = payload.username.strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,30}", candidate):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Username must be 3–30 characters: letters, numbers, . _ -",
        )
    if candidate != user.username:
        taken = (
            db.query(User)
            .filter(User.username == candidate, User.id != user.id)
            .first()
        )
        if taken is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken")
        # Sessions are keyed by user.id, so a rename keeps the user logged in.
        user.username = candidate
        db.commit()
        db.refresh(user)
    return user
