"""add user oauth + admin fields

Revision ID: e3b1c7d9a2f4
Revises: 7b1e9c4a2f55
Create Date: 2026-06-02 12:00:00.000000+00:00

Adds Google-OAuth + admin-approval support to users:
  - email, google_sub (nullable, unique) for Google sign-in / linking
  - is_admin (admin-approval gate), status (pending|approved|rejected)
  - password_hash becomes nullable (Google-only users have no password)

Existing rows are backfilled status='approved' (via server_default); the
primary account (username 'josia') is promoted to admin.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e3b1c7d9a2f4"
down_revision: Union[str, None] = "7b1e9c4a2f55"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("google_sub", sa.String(length=64), nullable=True))
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="approved"),
    )
    op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=True)
    op.create_unique_constraint("uq_users_email", "users", ["email"])
    op.create_unique_constraint("uq_users_google_sub", "users", ["google_sub"])
    # Promote the existing primary account to admin so approvals can be granted.
    op.execute("UPDATE users SET is_admin = true WHERE lower(username) = 'josia'")


def downgrade() -> None:
    op.drop_constraint("uq_users_google_sub", "users", type_="unique")
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=False)
    op.drop_column("users", "status")
    op.drop_column("users", "is_admin")
    op.drop_column("users", "google_sub")
    op.drop_column("users", "email")
