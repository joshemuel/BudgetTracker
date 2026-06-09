from pydantic import BaseModel


class LinkTokenOut(BaseModel):
    deep_link: str
    bot_username: str
    expires_in: int
