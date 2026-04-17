from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    telegram_chat_id: str | None = None

    model_config = {"from_attributes": True}
