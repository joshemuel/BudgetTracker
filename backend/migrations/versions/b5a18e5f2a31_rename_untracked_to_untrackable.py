"""rename untracked category to untrackable

Revision ID: b5a18e5f2a31
Revises: 8e8ebf9e5a1c
Create Date: 2026-04-17 21:25:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b5a18e5f2a31"
down_revision: Union[str, None] = "8e8ebf9e5a1c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE categories
            SET name = 'Untrackable'
            WHERE lower(name) = 'untracked'
              AND NOT EXISTS (
                SELECT 1
                FROM categories c2
                WHERE c2.user_id = categories.user_id
                  AND lower(c2.name) = 'untrackable'
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM categories c
            WHERE lower(c.name) = 'untracked'
              AND EXISTS (
                SELECT 1
                FROM categories c2
                WHERE c2.user_id = c.user_id
                  AND lower(c2.name) = 'untrackable'
              )
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE categories
            SET name = 'Untracked'
            WHERE lower(name) = 'untrackable'
            """
        )
    )
