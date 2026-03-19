"""Add external auth config + external users tables.

Revision ID: 027_external_auth_config_and_users
Revises: 026_kpi_role_assign
Create Date: 2026-03-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "027_ext_auth_cfg_users"
down_revision: Union[str, None] = "026_kpi_role_assign"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "external_auth_configs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("login_url", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index(op.f("ix_external_auth_configs_login_url"), "external_auth_configs", ["login_url"], unique=False)

    op.create_table(
        "external_users",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index(op.f("ix_external_users_user_id"), "external_users", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_external_users_user_id"), table_name="external_users")
    op.drop_table("external_users")
    op.drop_index(op.f("ix_external_auth_configs_login_url"), table_name="external_auth_configs")
    op.drop_table("external_auth_configs")

