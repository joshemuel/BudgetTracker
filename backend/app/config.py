from functools import lru_cache

from pydantic import AliasChoices
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"


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

    llm_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("GEMINI_API_KEY", "DASHSCOPE_API_KEY"),
    )
    llm_base_url: str = Field(
        default=GEMINI_OPENAI_BASE_URL,
        alias="LLM_BASE_URL",
    )
    llm_model: str = Field(default="gemini-2.5-flash-lite", alias="LLM_MODEL")
    llm_log_model: str = Field(default="gemini-2.5-flash-lite", alias="LLM_LOG_MODEL")
    llm_query_model: str = Field(default="gemini-2.5-flash", alias="LLM_QUERY_MODEL")

    tz: str = Field(default="Asia/Jakarta", alias="TZ")

    telegram_polling: bool = Field(default=False, alias="TELEGRAM_POLLING")

    session_cookie_secure: bool = Field(default=False, alias="SESSION_COOKIE_SECURE")


@lru_cache
def get_settings() -> Settings:
    return Settings()
