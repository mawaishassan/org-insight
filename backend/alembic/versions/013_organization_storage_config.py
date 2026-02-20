"""Add organization_storage_configs for Super Admin storage backend config.

Revision ID: 013_organization_storage_config
Revises: 012_export_api_tokens
Create Date: 2025-02-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "013_organization_storage_config"
down_revision: Union[str, None] = "012_export_api_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "organization_storage_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("storage_type", sa.String(32), nullable=False),
        sa.Column("params", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", name="uq_org_storage_config_org_id"),
    )
    op.create_index(
        op.f("ix_organization_storage_configs_organization_id"),
        "organization_storage_configs",
        ["organization_id"],
        unique=True,
    )
    op.create_index(
        op.f("ix_organization_storage_configs_storage_type"),
        "organization_storage_configs",
        ["storage_type"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_organization_storage_configs_storage_type"),
        table_name="organization_storage_configs",
    )
    op.drop_index(
        op.f("ix_organization_storage_configs_organization_id"),
        table_name="organization_storage_configs",
    )
    op.drop_table("organization_storage_configs")
