"""Add db_name to external auth config.

Revision ID: 028_ext_auth_cfg_db
Revises: 027_ext_auth_cfg_users
Create Date: 2026-03-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "028_ext_auth_cfg_db"
down_revision: Union[str, None] = "027_ext_auth_cfg_users"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "external_auth_configs",
        sa.Column("db_name", sa.Text(), nullable=False, server_default="OBE"),
    )


def downgrade() -> None:
    op.drop_column("external_auth_configs", "db_name")

