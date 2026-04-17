from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class SourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    current_balance: Decimal | None = None
    starting_balance: Decimal = Decimal("0")
    currency: str = Field(default="IDR", pattern="^(IDR|SGD|JPY|AUD|TWD)$")
    is_credit_card: bool = False
    active: bool = True


class SourceUpdate(BaseModel):
    name: str | None = None
    current_balance: Decimal | None = None
    starting_balance: Decimal | None = None
    currency: str | None = Field(default=None, pattern="^(IDR|SGD|JPY|AUD|TWD)$")
    is_credit_card: bool | None = None
    active: bool | None = None


class SourceOut(BaseModel):
    id: int
    name: str
    starting_balance: Decimal
    currency: str
    is_credit_card: bool
    active: bool
    current_balance: Decimal

    model_config = {"from_attributes": True}


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class CategoryUpdate(BaseModel):
    name: str | None = None


class CategoryOut(BaseModel):
    id: int
    name: str
    is_default: bool

    model_config = {"from_attributes": True}


class BudgetIn(BaseModel):
    category_id: int
    monthly_limit: Decimal


class BudgetUpdate(BaseModel):
    monthly_limit: Decimal | None = None


class BudgetOut(BaseModel):
    id: int
    category_id: int
    category_name: str
    monthly_limit: Decimal


TransactionType = Literal["expense", "income"]


class TransactionIn(BaseModel):
    occurred_at: datetime
    type: TransactionType
    category_id: int
    amount: Decimal
    source_id: int
    description: str | None = None
    transfer_group_id: UUID | None = None


class TransferIn(BaseModel):
    occurred_at: datetime
    amount: Decimal
    from_source_id: int
    to_source_id: int
    description: str | None = None


class TransactionUpdate(BaseModel):
    occurred_at: datetime | None = None
    type: TransactionType | None = None
    category_id: int | None = None
    amount: Decimal | None = None
    source_id: int | None = None
    description: str | None = None


class TransactionOut(BaseModel):
    id: int
    occurred_at: datetime
    type: TransactionType
    category_id: int
    category_name: str
    amount: Decimal
    source_id: int
    source_name: str
    description: str | None
    transfer_group_id: UUID | None
    subscription_charge_id: int | None
