from functools import lru_cache

from pydantic import AliasChoices
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql+psycopg://budget:budget@localhost:5432/budget",
        alias="DATABASE_URL",
    )
    app_secret: str = Field(default="dev-secret-change-me", alias="APP_SECRET")

    telegram_token: str = Field(default="", alias="TELEGRAM_TOKEN")
    telegram_chat_id: str = Field(default="", alias="TELEGRAM_CHAT_ID")
    # Shared secret echoed by Telegram in X-Telegram-Bot-Api-Secret-Token. When
    # set, inbound webhook updates that don't carry it are rejected.
    telegram_webhook_secret: str = Field(default="", alias="TELEGRAM_WEBHOOK_SECRET")
    # Normally discovered via getMe and cached in AppState (key TELEGRAM_BOT_USERNAME);
    # set this to override, e.g. after swapping bots while the cached row is stale.
    telegram_bot_username: str = Field(default="", alias="TELEGRAM_BOT_USERNAME")

    # Google OAuth (Authorization Code flow). Empty disables Google sign-in.
    google_client_id: str = Field(default="", alias="GOOGLE_CLIENT_ID")
    google_client_secret: str = Field(default="", alias="GOOGLE_CLIENT_SECRET")
    google_redirect_uri: str = Field(default="", alias="GOOGLE_REDIRECT_URI")
    # Extra ID-token audiences to accept besides GOOGLE_CLIENT_ID, comma-separated.
    # The web client id is always accepted; add an Android/iOS OAuth client id here
    # (when a native app ships) so its tokens verify with no code change.
    google_allowed_audiences: str = Field(default="", alias="GOOGLE_ALLOWED_AUDIENCES")
    # Where to send the browser after the OAuth callback. Empty = same-origin
    # relative redirect ("/"), correct for the single-origin nginx prod setup.
    frontend_base_url: str = Field(default="", alias="FRONTEND_BASE_URL")

    # Google Sheets auto-sync. Empty redirect URI disables the feature (the
    # "Connect Google Sheets" action 503s and status reports connected=false).
    # This redirect URI is registered as a SECOND authorized URI on the same
    # OAuth client as login, and resolves to the backend /sheets/callback route.
    google_sheets_redirect_uri: str = Field(default="", alias="GOOGLE_SHEETS_REDIRECT_URI")
    # Fernet key for encrypting stored Google refresh tokens at rest. When empty,
    # a key is derived from app_secret so self-hosting needs no extra config.
    google_token_enc_key: str = Field(default="", alias="GOOGLE_TOKEN_ENC_KEY")

    llm_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("OPENROUTER_API_KEY", "LLM_API_KEY"),
    )
    llm_base_url: str = Field(
        default=OPENROUTER_BASE_URL,
        alias="LLM_BASE_URL",
    )
    # Text path (intent classify, transaction extraction, queries, daily summary).
    llm_model: str = Field(default="deepseek/deepseek-v4-flash", alias="LLM_MODEL")
    llm_log_model: str = Field(default="deepseek/deepseek-v4-flash", alias="LLM_LOG_MODEL")
    llm_query_model: str = Field(default="deepseek/deepseek-v4-flash", alias="LLM_QUERY_MODEL")
    # Media paths — kept on a Google multimodal slug (audio + vision). OCR is a
    # separate knob so it can later point at a cheaper vision model with no code change.
    llm_media_model: str = Field(default="google/gemini-2.5-flash-lite", alias="LLM_MEDIA_MODEL")
    llm_ocr_model: str = Field(default="google/gemini-2.5-flash-lite", alias="LLM_OCR_MODEL")
    # OpenRouter ranking headers (https://openrouter.ai/docs/api-reference/overview).
    llm_referer: str = Field(default="https://budgettracker.ddns.net", alias="LLM_REFERER")
    llm_app_title: str = Field(default="BudgetTracker", alias="LLM_APP_TITLE")
    # Per-user input-token budget for the web "Ask Leo" chat, enforced as a 60s
    # sliding window so one account can't spam the LLM and run up the bill. Counts
    # estimated *input* tokens only (~len/4 for text, a flat cost per audio/image).
    llm_input_tokens_per_minute: int = Field(
        default=8000, alias="LLM_INPUT_TOKENS_PER_MINUTE"
    )

    tz: str = Field(default="Asia/Jakarta", alias="TZ")

    telegram_polling: bool = Field(default=False, alias="TELEGRAM_POLLING")

    session_cookie_secure: bool = Field(default=False, alias="SESSION_COOKIE_SECURE")


@lru_cache
def get_settings() -> Settings:
    return Settings()
