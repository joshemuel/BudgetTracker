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

    llm_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("GEMINI_API_KEY", "DASHSCOPE_API_KEY"),
    )
    llm_base_url: str = Field(
        default=GEMINI_OPENAI_BASE_URL,
        alias="LLM_BASE_URL",
    )
    llm_model: str = Field(default="gemini-2.5-flash-lite", alias="LLM_MODEL")
    llm_query_model: str = Field(default="gemini-2.5-flash", alias="LLM_QUERY_MODEL")

    tz: str = Field(default="Asia/Jakarta", alias="TZ")

    telegram_polling: bool = Field(default=False, alias="TELEGRAM_POLLING")

    session_cookie_secure: bool = Field(default=False, alias="SESSION_COOKIE_SECURE")


@lru_cache
def get_settings() -> Settings:
    return Settings()
