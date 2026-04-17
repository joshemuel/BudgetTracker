"""add currency to budgets

Revision ID: a7d2f9c48e15
Revises: b5a18e5f2a31
Create Date: 2026-04-18 00:00:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7d2f9c48e15"
down_revision: Union[str, None] = "b5a18e5f2a31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "budgets",
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="IDR"),
    )


def downgrade() -> None:
    op.drop_column("budgets", "currency")
