"""remove top-up category and remap existing data

Revision ID: d341278b88a9
Revises: a7d2f9c48e15
Create Date: 2026-04-18 09:30:00.000000+00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d341278b88a9"
down_revision: Union[str, None] = "a7d2f9c48e15"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    bind.execute(
        sa.text(
            """
            INSERT INTO categories (user_id, name, is_default)
            SELECT DISTINCT c.user_id, 'Untrackable', true
            FROM categories c
            WHERE lower(c.name) IN ('top-up', 'topup')
              AND NOT EXISTS (
                SELECT 1 FROM categories c2
                WHERE c2.user_id = c.user_id
                  AND lower(c2.name) = 'untrackable'
              )
            """
        )
    )

    bind.execute(
        sa.text(
            """
            UPDATE transactions t
            SET category_id = target.id
            FROM categories topup, categories target
            WHERE t.category_id = topup.id
              AND t.user_id = topup.user_id
              AND topup.user_id = target.user_id
              AND lower(topup.name) IN ('top-up', 'topup')
              AND lower(target.name) = 'untrackable'
            """
        )
    )

    bind.execute(
        sa.text(
            """
            UPDATE subscriptions s
            SET category_id = target.id
            FROM categories topup, categories target
            WHERE s.category_id = topup.id
              AND s.user_id = topup.user_id
              AND topup.user_id = target.user_id
              AND lower(topup.name) IN ('top-up', 'topup')
              AND lower(target.name) = 'untrackable'
            """
        )
    )

    bind.execute(
        sa.text(
            """
            DELETE FROM budgets b
            USING categories c
            WHERE b.category_id = c.id
              AND lower(c.name) IN ('top-up', 'topup')
            """
        )
    )

    bind.execute(
        sa.text(
            """
            DELETE FROM categories c
            WHERE lower(c.name) IN ('top-up', 'topup')
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO categories (user_id, name, is_default)
            SELECT u.id, 'Top-up', true
            FROM users u
            WHERE NOT EXISTS (
                SELECT 1 FROM categories c
                WHERE c.user_id = u.id
                  AND lower(c.name) IN ('top-up', 'topup')
            )
            """
        )
    )
