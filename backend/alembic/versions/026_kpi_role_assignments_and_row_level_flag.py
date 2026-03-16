"""Add kpi_role_assignments and row_level_user_access_enabled on kpi_fields.

Revision ID: 026_kpi_role_assign
Revises: 025_org_roles_fld_access
Create Date: 2026-03-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "026_kpi_role_assign"
down_revision: Union[str, None] = "025_org_roles_fld_access"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kpi_role_assignments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("organization_role_id", sa.Integer(), nullable=False),
        sa.Column("assignment_type", sa.String(20), nullable=False, server_default="data_entry"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_role_id"], ["organization_roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kpi_id", "organization_role_id", name="uq_kpi_role"),
    )
    op.create_index(op.f("ix_kpi_role_assignments_kpi_id"), "kpi_role_assignments", ["kpi_id"], unique=False)
    op.create_index(op.f("ix_kpi_role_assignments_organization_role_id"), "kpi_role_assignments", ["organization_role_id"], unique=False)

    op.add_column(
        "kpi_fields",
        sa.Column("row_level_user_access_enabled", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("kpi_fields", "row_level_user_access_enabled")
    op.drop_index(op.f("ix_kpi_role_assignments_organization_role_id"), table_name="kpi_role_assignments")
    op.drop_index(op.f("ix_kpi_role_assignments_kpi_id"), table_name="kpi_role_assignments")
    op.drop_table("kpi_role_assignments")
