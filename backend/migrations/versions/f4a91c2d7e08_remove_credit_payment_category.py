"""remove credit payment category and remap existing data

Revision ID: f4a91c2d7e08
Revises: d341278b88a9
Create Date: 2026-05-05 12:00:00.000000+00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f4a91c2d7e08"
down_revision: Union[str, None] = "d341278b88a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # Ensure every user that has a Credit Payment category also has Untrackable.
    bind.execute(
        sa.text(
            """
            INSERT INTO categories (user_id, name, is_default)
            SELECT DISTINCT c.user_id, 'Untrackable', true
            FROM categories c
            WHERE lower(c.name) = 'credit payment'
              AND NOT EXISTS (
                SELECT 1 FROM categories c2
                WHERE c2.user_id = c.user_id
                  AND lower(c2.name) = 'untrackable'
              )
            """
        )
    )

    # Remap transactions referencing Credit Payment to Untrackable. Mark them
    # internal so they stay excluded from spend totals (they always were).
    bind.execute(
        sa.text(
            """
            UPDATE transactions t
            SET category_id = target.id,
                is_internal = true
            FROM categories cp, categories target
            WHERE t.category_id = cp.id
              AND t.user_id = cp.user_id
              AND cp.user_id = target.user_id
              AND lower(cp.name) = 'credit payment'
              AND lower(target.name) = 'untrackable'
            """
        )
    )

    bind.execute(
        sa.text(
            """
            UPDATE subscriptions s
            SET category_id = target.id
            FROM categories cp, categories target
            WHERE s.category_id = cp.id
              AND s.user_id = cp.user_id
              AND cp.user_id = target.user_id
              AND lower(cp.name) = 'credit payment'
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
              AND lower(c.name) = 'credit payment'
            """
        )
    )

    bind.execute(
        sa.text(
            """
            DELETE FROM categories c
            WHERE lower(c.name) = 'credit payment'
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO categories (user_id, name, is_default)
            SELECT u.id, 'Credit Payment', true
            FROM users u
            WHERE NOT EXISTS (
                SELECT 1 FROM categories c
                WHERE c.user_id = u.id
                  AND lower(c.name) = 'credit payment'
            )
            """
        )
    )
