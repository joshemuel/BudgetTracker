from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

Frequency = Literal["monthly", "yearly"]
ChargeStatus = Literal["pending", "confirmed", "skipped"]


class SubscriptionIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    amount: Decimal
    currency: str = "IDR"
    source_id: int
    category_id: int
    billing_day: int = Field(ge=1, le=31)
    frequency: Frequency = "monthly"
    active: bool = True
    start_date: date
    end_date: date | None = None
    next_billing_date: date | None = None


class SubscriptionUpdate(BaseModel):
    name: str | None = None
    amount: Decimal | None = None
    currency: str | None = Field(default=None, pattern="^(IDR|SGD|JPY|AUD|TWD)$")
    source_id: int | None = None
    category_id: int | None = None
    billing_day: int | None = Field(default=None, ge=1, le=31)
    frequency: Frequency | None = None
    active: bool | None = None
    end_date: date | None = None
    next_billing_date: date | None = None


class SubscriptionMonthlyTotal(BaseModel):
    total: Decimal
    currency: str


class SubscriptionOut(BaseModel):
    id: int
    name: str
    amount: Decimal
    currency: str
    source_id: int
    source_name: str
    category_id: int
    category_name: str
    billing_day: int
    frequency: Frequency
    active: bool
    start_date: date
    end_date: date | None
    next_billing_date: date
    last_billed_at: datetime | None


class ChargeOut(BaseModel):
    id: int
    subscription_id: int
    subscription_name: str
    due_date: date
    status: ChargeStatus
    transaction_id: int | None
    notified_at: datetime | None
    resolved_at: datetime | None
