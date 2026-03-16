"""Add kpi_field_access table for field-level view/edit permissions.

Revision ID: 023_kpi_field_access
Revises: 022_full_page_multi_items
Create Date: 2026-03-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "023_kpi_field_access"
down_revision: Union[str, None] = "022_full_page_multi_items"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kpi_field_access",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("field_id", sa.Integer(), nullable=False),
        sa.Column("sub_field_id", sa.Integer(), nullable=True),
        sa.Column("access_type", sa.String(20), nullable=False, server_default="data_entry"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["field_id"], ["kpi_fields.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sub_field_id"], ["kpi_field_sub_fields.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_kpi_field_access_user_id"), "kpi_field_access", ["user_id"], unique=False)
    op.create_index(op.f("ix_kpi_field_access_kpi_id"), "kpi_field_access", ["kpi_id"], unique=False)
    op.create_index(op.f("ix_kpi_field_access_field_id"), "kpi_field_access", ["field_id"], unique=False)
    op.create_index(op.f("ix_kpi_field_access_sub_field_id"), "kpi_field_access", ["sub_field_id"], unique=False)
    # Partial unique: one row per (user, kpi, field) when sub_field_id IS NULL
    # Partial unique: one row per (user, kpi, field, sub_field) when sub_field_id IS NOT NULL
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.execute(
            "CREATE UNIQUE INDEX uq_kpi_field_access_whole_field "
            "ON kpi_field_access (user_id, kpi_id, field_id) WHERE sub_field_id IS NULL"
        )
        op.execute(
            "CREATE UNIQUE INDEX uq_kpi_field_access_sub "
            "ON kpi_field_access (user_id, kpi_id, field_id, sub_field_id) WHERE sub_field_id IS NOT NULL"
        )
    elif conn.dialect.name == "sqlite":
        op.execute(
            "CREATE UNIQUE INDEX uq_kpi_field_access_whole_field "
            "ON kpi_field_access (user_id, kpi_id, field_id) WHERE sub_field_id IS NULL"
        )
        op.execute(
            "CREATE UNIQUE INDEX uq_kpi_field_access_sub "
            "ON kpi_field_access (user_id, kpi_id, field_id, sub_field_id) WHERE sub_field_id IS NOT NULL"
        )
    else:
        # MySQL etc: single unique on all four columns (allows multiple NULLs for sub_field_id)
        op.create_unique_constraint(
            "uq_kpi_field_access_user_kpi_field_sub",
            "kpi_field_access",
            ["user_id", "kpi_id", "field_id", "sub_field_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name in ("postgresql", "sqlite"):
        op.execute("DROP INDEX IF EXISTS uq_kpi_field_access_whole_field")
        op.execute("DROP INDEX IF EXISTS uq_kpi_field_access_sub")
    else:
        op.drop_constraint("uq_kpi_field_access_user_kpi_field_sub", "kpi_field_access", type_="unique")
    op.drop_index(op.f("ix_kpi_field_access_sub_field_id"), table_name="kpi_field_access")
    op.drop_index(op.f("ix_kpi_field_access_field_id"), table_name="kpi_field_access")
    op.drop_index(op.f("ix_kpi_field_access_kpi_id"), table_name="kpi_field_access")
    op.drop_index(op.f("ix_kpi_field_access_user_id"), table_name="kpi_field_access")
    op.drop_table("kpi_field_access")
