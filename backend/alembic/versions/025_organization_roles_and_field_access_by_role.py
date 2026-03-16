"""Add organization roles, user-role assignment, and KPI field access by role.

Revision ID: 025_org_roles_field_access_by_role
Revises: 024_kpi_multi_line_row_access
Create Date: 2026-03-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "025_org_roles_fld_access"
down_revision: Union[str, None] = "024_kpi_multi_line_row_access"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "organization_roles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "name", name="uq_org_role_name"),
    )
    op.create_index(op.f("ix_organization_roles_organization_id"), "organization_roles", ["organization_id"], unique=False)

    op.create_table(
        "user_organization_roles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("organization_role_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_role_id"], ["organization_roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "organization_role_id", name="uq_user_org_role"),
    )
    op.create_index(op.f("ix_user_organization_roles_organization_role_id"), "user_organization_roles", ["organization_role_id"], unique=False)
    op.create_index(op.f("ix_user_organization_roles_user_id"), "user_organization_roles", ["user_id"], unique=False)

    op.create_table(
        "kpi_field_access_by_role",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("organization_role_id", sa.Integer(), nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("field_id", sa.Integer(), nullable=False),
        sa.Column("sub_field_id", sa.Integer(), nullable=True),
        sa.Column("access_type", sa.String(20), nullable=False, server_default="data_entry"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["field_id"], ["kpi_fields.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_role_id"], ["organization_roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sub_field_id"], ["kpi_field_sub_fields.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_kpi_field_access_by_role_field_id"), "kpi_field_access_by_role", ["field_id"], unique=False)
    op.create_index(op.f("ix_kpi_field_access_by_role_kpi_id"), "kpi_field_access_by_role", ["kpi_id"], unique=False)
    op.create_index(op.f("ix_kpi_field_access_by_role_organization_role_id"), "kpi_field_access_by_role", ["organization_role_id"], unique=False)
    op.create_index(op.f("ix_kpi_field_access_by_role_sub_field_id"), "kpi_field_access_by_role", ["sub_field_id"], unique=False)
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.execute(
            "CREATE UNIQUE INDEX uq_kpi_field_access_by_role_whole "
            "ON kpi_field_access_by_role (organization_role_id, kpi_id, field_id) WHERE sub_field_id IS NULL"
        )
        op.execute(
            "CREATE UNIQUE INDEX uq_kpi_field_access_by_role_sub "
            "ON kpi_field_access_by_role (organization_role_id, kpi_id, field_id, sub_field_id) WHERE sub_field_id IS NOT NULL"
        )
    elif conn.dialect.name == "sqlite":
        op.execute(
            "CREATE UNIQUE INDEX uq_kpi_field_access_by_role_whole "
            "ON kpi_field_access_by_role (organization_role_id, kpi_id, field_id) WHERE sub_field_id IS NULL"
        )
        op.execute(
            "CREATE UNIQUE INDEX uq_kpi_field_access_by_role_sub "
            "ON kpi_field_access_by_role (organization_role_id, kpi_id, field_id, sub_field_id) WHERE sub_field_id IS NOT NULL"
        )
    else:
        op.create_unique_constraint(
            "uq_kpi_field_access_by_role_role_kpi_field_sub",
            "kpi_field_access_by_role",
            ["organization_role_id", "kpi_id", "field_id", "sub_field_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name in ("postgresql", "sqlite"):
        op.execute("DROP INDEX IF EXISTS uq_kpi_field_access_by_role_whole")
        op.execute("DROP INDEX IF EXISTS uq_kpi_field_access_by_role_sub")
    else:
        op.drop_constraint("uq_kpi_field_access_by_role_role_kpi_field_sub", "kpi_field_access_by_role", type_="unique")
    op.drop_index(op.f("ix_kpi_field_access_by_role_sub_field_id"), table_name="kpi_field_access_by_role")
    op.drop_index(op.f("ix_kpi_field_access_by_role_organization_role_id"), table_name="kpi_field_access_by_role")
    op.drop_index(op.f("ix_kpi_field_access_by_role_kpi_id"), table_name="kpi_field_access_by_role")
    op.drop_index(op.f("ix_kpi_field_access_by_role_field_id"), table_name="kpi_field_access_by_role")
    op.drop_table("kpi_field_access_by_role")
    op.drop_index(op.f("ix_user_organization_roles_user_id"), table_name="user_organization_roles")
    op.drop_index(op.f("ix_user_organization_roles_organization_role_id"), table_name="user_organization_roles")
    op.drop_table("user_organization_roles")
    op.drop_index(op.f("ix_organization_roles_organization_id"), table_name="organization_roles")
    op.drop_table("organization_roles")
