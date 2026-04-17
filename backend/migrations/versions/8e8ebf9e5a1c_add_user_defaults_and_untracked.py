"""add user defaults and untracked category

Revision ID: 8e8ebf9e5a1c
Revises: c2a19f44b0ad
Create Date: 2026-04-17 19:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8e8ebf9e5a1c"
down_revision: Union[str, None] = "c2a19f44b0ad"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("default_currency", sa.String(length=3), nullable=False, server_default="IDR"),
    )
    op.add_column("users", sa.Column("default_expense_source_id", sa.Integer(), nullable=True))

    bind = op.get_bind()
    # Seed Untracked for all users if missing
    bind.execute(
        sa.text(
            """
            INSERT INTO categories (user_id, name, is_default)
            SELECT u.id, 'Untracked', true
            FROM users u
            WHERE NOT EXISTS (
                SELECT 1 FROM categories c
                WHERE c.user_id = u.id AND lower(c.name) = 'untracked'
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_column("users", "default_expense_source_id")
    op.drop_column("users", "default_currency")
