# Security Assessment & Hardening — BudgetTracker

_Last reviewed: 2026-06-02 (pre-production scale-up review)._

This document records the security review of BudgetTracker (FastAPI + Postgres + React,
deployed on EC2 behind nginx/TLS) ahead of opening it to more than one user, the critical
fixes applied, and the operator checklist for a safe production deployment.

## Summary

The core of the app was already in good shape: bcrypt password hashing, server-side
session tokens with expiry, `httponly` + `samesite=lax` + `secure` cookies in prod,
per-`user_id` scoping on every query (no horizontal data leakage found), parameterised
SQL throughout (no injection surface), TLS + HSTS + `X-Frame-Options`/`nosniff` at nginx,
and login rate-limiting. No use of `dangerouslySetInnerHTML` on the frontend.

Two **critical authentication-bypass** endpoints and several hardening gaps were found and
fixed in this change. One reported "secrets committed to git" finding was **investigated and
disproven** — `.env` is `.gitignore`d and `git log --all -- .env` returns nothing, so the
secrets live only in the working tree and were never published. Rotation is therefore
optional, not urgent (see checklist).

## Critical issues — FIXED in this change

| # | Issue | Fix |
|---|-------|-----|
| 1 | `POST /telegram/web_chat` accepted a `username` in the request body and executed financial commands as that user with **no authentication** — anyone who knew a username could create/delete transactions or read data. | Endpoint now derives the acting user from the authenticated session (`Depends(get_current_user)`); the body `username` field is ignored/removed. Frontend `WebChat` no longer sends it. |
| 2 | `POST /telegram/set_webhook` had **no authentication** — an attacker could repoint the Telegram webhook to their own server and intercept all bot traffic (including `/login` credentials). | Endpoint now requires an authenticated **admin** (`Depends(get_current_admin)`). |
| 3 | `POST /telegram/webhook` processed any inbound POST without verifying it came from Telegram. | When `TELEGRAM_WEBHOOK_SECRET` is set, the handler verifies the `X-Telegram-Bot-Api-Secret-Token` header and rejects mismatches. The secret is registered with Telegram via `set_webhook`. |

## Hardening — applied in this change

- **Container runs as non-root.** `backend/Dockerfile` adds an `appuser` (uid 10001) and
  `USER appuser`. `--reload` removed from the image default (production-safe); dev opts back
  in via the compose `command:` override.
- **Content-Security-Policy** added at nginx (`default-src 'self'`, `script-src 'self'`,
  styles/fonts limited to Google Fonts, `frame-ancestors 'none'`, `object-src 'none'`,
  `base-uri`/`form-action 'self'`). The inline theme script was externalised to
  `/theme-init.js` so `script-src` needs no `'unsafe-inline'`. Security headers are also
  repeated on the `= /index.html` location (nginx `add_header` does not merge into locations
  that set their own headers).
- **Account-status gating.** `get_current_user` now rejects non-`approved` users (403), and
  password/Telegram login reject pending/rejected accounts. New `get_current_admin`
  dependency for admin-only routes.
- **Null-password safety.** With Google-only users now possible (`password_hash` nullable),
  all `verify_password` call sites guard against a missing hash.

## Deferred to a later "full hardening" pass

These were scoped out of this round (assessment + critical fixes):

- Broader rate-limiting (currently only `/api/auth/login`) — e.g. on password change,
  transaction creation, and the OAuth callback.
- Dependency pinning with upper bounds + an automated vulnerability scan (`pip-audit`,
  `npm audit`) in CI.
- Password complexity policy (currently min length 8 only).
- Audit logging of sensitive actions.
- Moving secrets from env vars to a managed secret store (AWS Secrets Manager) for the
  eventual ECS/Fargate target.

## Operator checklist before going wider

1. **`APP_SECRET`** — set to a long random value in prod (used to sign the OAuth state
   cookie). Generate: `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
2. **`TELEGRAM_WEBHOOK_SECRET`** — set to a random value, then re-register the webhook
   (`POST /api/telegram/set_webhook {"url": "..."}` as admin) so Telegram echoes it.
3. **`SESSION_COOKIE_SECURE=true`** — already set in `docker-compose.prod.yml`; keep it.
4. **Google OAuth** — set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
   (see `README`/`.env.example`). New Google sign-ups land in `pending` until an admin
   approves them in Settings → Pending users.
5. **Secret rotation (optional)** — the Telegram token and Gemini key in the working-tree
   `.env` were never committed; rotate only if you suspect local exposure.
6. **Reload nginx** after deploying the updated `nginx/budgettracker.conf`
   (`sudo nginx -t && sudo systemctl reload nginx`).
7. Confirm Postgres remains unpublished (prod compose binds backend to `127.0.0.1:8000`
   and does not expose the DB port — verified).
