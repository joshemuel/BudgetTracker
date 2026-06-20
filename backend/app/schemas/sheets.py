from datetime import datetime

from pydantic import BaseModel


class SheetsStatusOut(BaseModel):
    connected: bool
    google_email: str | None = None
    auto_sync: bool = False
    spreadsheet_url: str | None = None
    last_synced_at: datetime | None = None
    last_sync_error: str | None = None


class AutoSyncUpdate(BaseModel):
    auto_sync: bool
