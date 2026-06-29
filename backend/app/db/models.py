from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as SqlUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


DEFAULT_CATEGORIES: list[str] = [
    "Food",
    "Coffee",
    "Transport",
    "Subscriptions",
    "Entertainment",
    "Shopping",
    "Health",
    "Utilities",
    "Rent",
    "Education",
    "Salary",
    "Freelance",
    "Gift",
    "Gadgets",
    "Groceries",
    "Other",
    "Investment",
    "Untrackable",
]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Nullable: Google-only users authenticate via OAuth and have no password.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    google_sub: Mapped[str | None] = mapped_column(String(64), unique=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # "pending" | "approved" | "rejected". New Google registrations start pending.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="approved")
    telegram_chat_id: Mapped[str | None] = mapped_column(String(64))
    default_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="IDR")
    default_expense_source_id: Mapped[int | None] = mapped_column(Integer)
    sources_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # UI theme "skin": "editorial" (original look, default) | "pastel" (new look).
    # Orthogonal to light/dark mode, which stays a client-only preference. Persisted
    # so the owner can see which theme users prefer during the A/B rollout.
    theme_skin: Mapped[str] = mapped_column(String(16), nullable=False, default="editorial")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Source(Base):
    __tablename__ = "sources"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_sources_user_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="IDR")
    starting_balance: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0")
    )
    is_credit_card: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class CurrencySourceDefault(Base):
    __tablename__ = "currency_source_defaults"
    __table_args__ = (
        UniqueConstraint("user_id", "currency", name="uq_currency_source_defaults_user_currency"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_categories_user_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("user_id", "category_id", name="uq_budgets_user_category"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=False
    )
    monthly_limit: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="IDR")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="IDR")
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id"), nullable=False)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    billing_day: Mapped[int] = mapped_column(Integer, nullable=False)
    frequency: Mapped[str] = mapped_column(String(16), nullable=False, default="monthly")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    next_billing_date: Mapped[date] = mapped_column(Date, nullable=False)
    last_billed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    charges: Mapped[list[SubscriptionCharge]] = relationship(
        back_populates="subscription", cascade="all, delete-orphan"
    )


class SubscriptionCharge(Base):
    __tablename__ = "subscription_charges"
    __table_args__ = (UniqueConstraint("subscription_id", "due_date", name="uq_subcharge_sub_due"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="CASCADE"), nullable=False
    )
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", use_alter=True, name="fk_subcharge_transaction")
    )
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    subscription: Mapped[Subscription] = relationship(back_populates="charges")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)  # 'expense' | 'income'
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id"), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="IDR")
    description: Mapped[str | None] = mapped_column(Text)
    subscription_charge_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "subscription_charges.id",
            use_alter=True,
            name="fk_transaction_subcharge",
        )
    )
    transfer_group_id: Mapped[UUID | None] = mapped_column(SqlUUID(as_uuid=True))
    is_internal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fx_rate: Mapped[Decimal | None] = mapped_column(Numeric(20, 10))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SessionToken(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AppState(Base):
    __tablename__ = "app_state"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class GoogleCredential(Base):
    """Per-user Google Sheets connection (one-to-one with User).

    Holds the encrypted OAuth refresh token plus the id/url of the spreadsheet
    we created for this user. Presence of a row = the user opted in. The hourly
    scheduler job rewrites the workbook for every row where auto_sync is true.
    """

    __tablename__ = "google_credentials"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    google_email: Mapped[str | None] = mapped_column(String(255))
    # Fernet ciphertext of the Google OAuth refresh token (never returned to clients).
    refresh_token_enc: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    auto_sync: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    spreadsheet_id: Mapped[str | None] = mapped_column(String(128))
    spreadsheet_url: Mapped[str | None] = mapped_column(String(512))
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_error: Mapped[str | None] = mapped_column(Text)
