"""add currency to sources

Revision ID: c2a19f44b0ad
Revises: 6900ef993023
Create Date: 2026-04-17 08:05:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2a19f44b0ad"
down_revision: Union[str, None] = "6900ef993023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sources",
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="IDR"),
    )


def downgrade() -> None:
    op.drop_column("sources", "currency")
