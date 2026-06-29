"""add users.theme_skin for the dual-theme A/B rollout

Revision ID: a1b2c3d4e5f6
Revises: f7c3a9b2e1d0
Create Date: 2026-06-28 12:00:00.000000+00:00

Per-user UI theme "skin": "editorial" (original look, the default) or "pastel"
(the new look). Orthogonal to light/dark mode (which stays client-only). The
server_default backfills existing users to the default skin so prod keeps the
current look until a user opts in.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f7c3a9b2e1d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "theme_skin",
            sa.String(length=16),
            nullable=False,
            server_default="editorial",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "theme_skin")
