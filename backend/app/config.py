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

    llm_api_key: str = Field(default="", alias="DASHSCOPE_API_KEY")
    llm_base_url: str = Field(
        default="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        alias="LLM_BASE_URL",
    )
    llm_model: str = Field(default="qwen3.5-omni-flash", alias="LLM_MODEL")
    llm_query_model: str = Field(default="qwen-plus", alias="LLM_QUERY_MODEL")

    tz: str = Field(default="Asia/Jakarta", alias="TZ")

    telegram_polling: bool = Field(default=False, alias="TELEGRAM_POLLING")

    session_cookie_secure: bool = Field(default=False, alias="SESSION_COOKIE_SECURE")


@lru_cache
def get_settings() -> Settings:
    return Settings()
