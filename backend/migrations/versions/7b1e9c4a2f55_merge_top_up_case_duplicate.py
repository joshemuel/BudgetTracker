"""merge case-duplicate 'Top-Up' into 'Top-up' for Josia

Revision ID: 7b1e9c4a2f55
Revises: 5d82118c217a
Create Date: 2026-06-02 12:00:00.000000+00:00

User Josia ended up with two categories that differ only in case — 'Top-up' and
'Top-Up'. This collapses the case variants into the canonical 'Top-up', moving
every transaction / subscription / budget that referenced a variant onto the
canonical row, then deleting the leftover duplicate(s). Scoped to Josia per the
request; idempotent (a no-op when no duplicate exists). Not reversible.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "7b1e9c4a2f55"
down_revision: Union[str, None] = "5d82118c217a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # Ensure a canonical 'Top-up' exists for Josia: if only a case variant is
    # present (e.g. 'Top-Up'), rename the lowest-id variant to the canonical name.
    bind.execute(
        sa.text(
            """
            UPDATE categories
            SET name = 'Top-up'
            WHERE id = (
                SELECT c.id FROM categories c
                JOIN users u ON u.id = c.user_id
                WHERE lower(u.username) = 'josia' AND lower(c.name) = 'top-up'
                ORDER BY (c.name = 'Top-up') DESC, c.id
                LIMIT 1
            )
            AND NOT EXISTS (
                SELECT 1 FROM categories c2
                JOIN users u2 ON u2.id = c2.user_id
                WHERE lower(u2.username) = 'josia' AND c2.name = 'Top-up'
            )
            """
        )
    )

    # Re-point transactions and subscriptions from the duplicate(s) to canonical.
    for table in ("transactions", "subscriptions"):
        bind.execute(
            sa.text(
                f"""
                UPDATE {table} x
                SET category_id = canon.id
                FROM categories canon, categories dup, users u
                WHERE lower(u.username) = 'josia'
                  AND canon.user_id = u.id AND canon.name = 'Top-up'
                  AND dup.user_id = u.id AND lower(dup.name) = 'top-up'
                  AND dup.id <> canon.id
                  AND x.category_id = dup.id
                """
            )
        )

    # Budgets are unique per (user_id, category_id): drop a duplicate's budget if
    # the canonical already has one, otherwise move it over.
    bind.execute(
        sa.text(
            """
            DELETE FROM budgets b
            USING categories canon, categories dup, users u
            WHERE lower(u.username) = 'josia'
              AND canon.user_id = u.id AND canon.name = 'Top-up'
              AND dup.user_id = u.id AND lower(dup.name) = 'top-up'
              AND dup.id <> canon.id
              AND b.category_id = dup.id
              AND EXISTS (SELECT 1 FROM budgets b2 WHERE b2.category_id = canon.id)
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE budgets b
            SET category_id = canon.id
            FROM categories canon, categories dup, users u
            WHERE lower(u.username) = 'josia'
              AND canon.user_id = u.id AND canon.name = 'Top-up'
              AND dup.user_id = u.id AND lower(dup.name) = 'top-up'
              AND dup.id <> canon.id
              AND b.category_id = dup.id
            """
        )
    )

    # Remove the now-orphaned duplicate category row(s).
    bind.execute(
        sa.text(
            """
            DELETE FROM categories dup
            USING categories canon, users u
            WHERE lower(u.username) = 'josia'
              AND canon.user_id = u.id AND canon.name = 'Top-up'
              AND dup.user_id = u.id AND lower(dup.name) = 'top-up'
              AND dup.id <> canon.id
            """
        )
    )


def downgrade() -> None:
    # Merging is one-way: the original split between 'Top-up' and 'Top-Up' cannot
    # be reconstructed once the rows are combined.
    pass
