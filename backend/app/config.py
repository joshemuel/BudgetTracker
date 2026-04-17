from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql+psycopg://budget:budget@localhost:5432/budget",
        alias="DATABASE_URL",
    )
    app_secret: str = Field(default="dev-secret-change-me", alias="APP_SECRET")

    telegram_token: str = Field(default="", alias="TELEGRAM_TOKEN")
    telegram_chat_id: str = Field(default="", alias="TELEGRAM_CHAT_ID")

    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-2.5-flash-lite", alias="GEMINI_MODEL")

    tz: str = Field(default="Asia/Jakarta", alias="TZ")


@lru_cache
def get_settings() -> Settings:
    return Settings()
