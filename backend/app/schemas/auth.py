from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None = None
    is_admin: bool = False
    status: str = "approved"
    telegram_chat_id: str | None = None
    default_currency: str = "IDR"
    default_expense_source_id: int | None = None
    sources_enabled: bool = True

    model_config = {"from_attributes": True}


class UserPreferencesUpdate(BaseModel):
    default_currency: str | None = None
    default_expense_source_id: int | None = None
    sources_enabled: bool | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
