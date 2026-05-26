"""add sources toggle and currency routing

Revision ID: 5d82118c217a
Revises: f4a91c2d7e08
Create Date: 2026-05-22 00:00:00.000000+00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "5d82118c217a"
down_revision: Union[str, None] = "f4a91c2d7e08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("sources_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "transactions",
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="IDR"),
    )
    op.create_table(
        "currency_source_defaults",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "currency", name="uq_currency_source_defaults_user_currency"),
    )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE transactions t
            SET currency = upper(coalesce(s.currency, 'IDR'))
            FROM sources s
            WHERE t.source_id = s.id
            """
        )
    )
    bind.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT s.user_id,
                       upper(coalesce(s.currency, 'IDR')) AS currency,
                       s.id AS source_id,
                       row_number() OVER (
                           PARTITION BY s.user_id, upper(coalesce(s.currency, 'IDR'))
                           ORDER BY CASE WHEN s.id = u.default_expense_source_id THEN 0 ELSE 1 END,
                                    s.name,
                                    s.id
                       ) AS rank
                FROM sources s
                JOIN users u ON u.id = s.user_id
                WHERE s.active = true
            )
            INSERT INTO currency_source_defaults (user_id, currency, source_id)
            SELECT user_id, currency, source_id
            FROM ranked
            WHERE rank = 1
            """
        )
    )


def downgrade() -> None:
    op.drop_table("currency_source_defaults")
    op.drop_column("transactions", "currency")
    op.drop_column("users", "sources_enabled")
