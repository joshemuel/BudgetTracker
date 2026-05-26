"""add fx_rate to transactions

Revision ID: 9c7e4f2a1d3b
Revises: f4a91c2d7e08
Create Date: 2026-05-22 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9c7e4f2a1d3b"
down_revision: Union[str, None] = "f4a91c2d7e08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column("fx_rate", sa.Numeric(20, 10), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("transactions", "fx_rate")
