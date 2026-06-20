"""Google OAuth2 (Authorization Code) + OIDC helpers.

The ID token is fetched server-to-server from Google's token endpoint over TLS,
so its signature does not need re-verification on this trusted channel; we still
validate audience, issuer and expiry. The CSRF `state` is a short-lived value
signed with APP_SECRET (itsdangerous), mirrored in an httponly cookie.
"""

import base64
import hashlib
import json
import secrets
import time
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import get_settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
# Least-privilege Sheets scope: drive.file lets us create + manage only files we
# created (the budget spreadsheet). It is NON-sensitive, so it needs no Google
# verification review, unlike the broad spreadsheets scope.
SHEETS_SCOPE = "openid email https://www.googleapis.com/auth/drive.file"
_VALID_ISS = {"accounts.google.com", "https://accounts.google.com"}
STATE_MAX_AGE = 600  # seconds


class OAuthError(Exception):
    """Any failure in the OAuth handshake (state, token exchange, id_token)."""


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().app_secret, salt="google-oauth-state")


def make_state() -> str:
    return _serializer().dumps({"n": secrets.token_urlsafe(16)})


def verify_state(value: str) -> bool:
    try:
        _serializer().loads(value, max_age=STATE_MAX_AGE)
        return True
    except (BadSignature, SignatureExpired):
        return False


def authorize_url(state: str) -> str:
    s = get_settings()
    params = {
        "client_id": s.google_client_id,
        "redirect_uri": s.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def sheets_authorize_url(state: str) -> str:
    """Authorize URL for the Sheets connection (separate from the login grant).

    Uses access_type=offline + prompt=consent so Google always returns a refresh
    token, and the drive.file scope so we can create/write the user's workbook.
    """
    s = get_settings()
    params = {
        "client_id": s.google_client_id,
        "redirect_uri": s.google_sheets_redirect_uri,
        "response_type": "code",
        "scope": SHEETS_SCOPE,
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str, redirect_uri: str | None = None) -> dict:
    s = get_settings()
    with httpx.Client(timeout=15.0) as c:
        r = c.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "redirect_uri": redirect_uri or s.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    if r.status_code != 200:
        raise OAuthError("token exchange failed")
    return r.json()


def refresh_access_token(refresh_token: str) -> str:
    """Exchange a stored refresh token for a fresh access token (used at sync time)."""
    s = get_settings()
    with httpx.Client(timeout=15.0) as c:
        r = c.post(
            GOOGLE_TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "grant_type": "refresh_token",
            },
        )
    if r.status_code != 200:
        raise OAuthError("access-token refresh failed")
    token = r.json().get("access_token")
    if not token:
        raise OAuthError("no access_token in refresh response")
    return token


def revoke_token(token: str) -> None:
    """Best-effort revoke of a refresh/access token at Google. Never raises."""
    try:
        with httpx.Client(timeout=10.0) as c:
            c.post(GOOGLE_REVOKE_URL, data={"token": token})
    except httpx.HTTPError:
        pass


def _fernet() -> Fernet:
    """Fernet from GOOGLE_TOKEN_ENC_KEY, else derived deterministically from
    app_secret so self-hosting works with no extra configuration."""
    s = get_settings()
    key = s.google_token_enc_key.strip()
    if not key:
        digest = hashlib.sha256(s.app_secret.encode()).digest()
        key = base64.urlsafe_b64encode(digest).decode()
    return Fernet(key.encode())


def encrypt_token(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()


def _b64url_decode(seg: str) -> bytes:
    return base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4))


def _accepted_audiences() -> set[str]:
    """Audiences whose ID tokens we trust: the web client id plus any extras
    (e.g. a future Android/iOS OAuth client id) from GOOGLE_ALLOWED_AUDIENCES."""
    s = get_settings()
    auds = {s.google_client_id}
    auds.update(a.strip() for a in s.google_allowed_audiences.split(","))
    return {a for a in auds if a}


def decode_id_token(token: str | None) -> dict:
    if not token or token.count(".") != 2:
        raise OAuthError("missing id_token")
    try:
        claims = json.loads(_b64url_decode(token.split(".")[1]))
    except Exception as exc:  # noqa: BLE001
        raise OAuthError("malformed id_token") from exc
    if claims.get("aud") not in _accepted_audiences():
        raise OAuthError("id_token audience mismatch")
    if claims.get("iss") not in _VALID_ISS:
        raise OAuthError("id_token issuer mismatch")
    if int(claims.get("exp", 0)) < int(time.time()):
        raise OAuthError("id_token expired")
    return claims
