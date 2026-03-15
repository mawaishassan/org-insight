"""Add kpi_multi_line_row_access table for record-level edit/delete on multi_line_items.

Revision ID: 024_kpi_multi_line_row_access
Revises: 023_kpi_field_access
Create Date: 2026-03-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "024_kpi_multi_line_row_access"
down_revision: Union[str, None] = "023_kpi_field_access"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kpi_multi_line_row_access",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("entry_id", sa.Integer(), nullable=False),
        sa.Column("field_id", sa.Integer(), nullable=False),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("can_edit", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("can_delete", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["entry_id"], ["kpi_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["field_id"], ["kpi_fields.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "entry_id", "field_id", "row_index",
            name="uq_kpi_multi_line_row_access_user_entry_field_row",
        ),
    )
    op.create_index(
        op.f("ix_kpi_multi_line_row_access_user_id"),
        "kpi_multi_line_row_access",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_kpi_multi_line_row_access_entry_id"),
        "kpi_multi_line_row_access",
        ["entry_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_kpi_multi_line_row_access_field_id"),
        "kpi_multi_line_row_access",
        ["field_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_kpi_multi_line_row_access_field_id"),
        table_name="kpi_multi_line_row_access",
    )
    op.drop_index(
        op.f("ix_kpi_multi_line_row_access_entry_id"),
        table_name="kpi_multi_line_row_access",
    )
    op.drop_index(
        op.f("ix_kpi_multi_line_row_access_user_id"),
        table_name="kpi_multi_line_row_access",
    )
    op.drop_table("kpi_multi_line_row_access")
