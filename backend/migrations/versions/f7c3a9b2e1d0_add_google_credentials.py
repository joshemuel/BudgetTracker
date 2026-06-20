"""add google_credentials for Sheets auto-sync

Revision ID: f7c3a9b2e1d0
Revises: e3b1c7d9a2f4
Create Date: 2026-06-20 12:00:00.000000+00:00

Per-user Google Sheets connection. One row per opted-in user, holding the
encrypted OAuth refresh token and the spreadsheet we created for them. The
hourly scheduler job rewrites the workbook for every row where auto_sync is true.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f7c3a9b2e1d0"
down_revision: Union[str, None] = "e3b1c7d9a2f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "google_credentials",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("google_email", sa.String(length=255), nullable=True),
        sa.Column("refresh_token_enc", sa.Text(), nullable=False),
        sa.Column("scopes", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("auto_sync", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("spreadsheet_id", sa.String(length=128), nullable=True),
        sa.Column("spreadsheet_url", sa.String(length=512), nullable=True),
        sa.Column(
            "connected_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("google_credentials")
