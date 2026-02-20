"""Add kpi_files table for KPI file attachments.

Revision ID: 014_kpi_files
Revises: 013_organization_storage_config
Create Date: 2025-02-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "014_kpi_files"
down_revision: Union[str, None] = "013_organization_storage_config"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kpi_files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("entry_id", sa.Integer(), nullable=True),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("stored_path", sa.String(2048), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["entry_id"], ["kpi_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_kpi_files_kpi_id"), "kpi_files", ["kpi_id"], unique=False)
    op.create_index(op.f("ix_kpi_files_organization_id"), "kpi_files", ["organization_id"], unique=False)
    op.create_index(op.f("ix_kpi_files_year"), "kpi_files", ["year"], unique=False)
    op.create_index(op.f("ix_kpi_files_entry_id"), "kpi_files", ["entry_id"], unique=False)
    op.create_index(op.f("ix_kpi_files_uploaded_by_user_id"), "kpi_files", ["uploaded_by_user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_kpi_files_uploaded_by_user_id"), table_name="kpi_files")
    op.drop_index(op.f("ix_kpi_files_entry_id"), table_name="kpi_files")
    op.drop_index(op.f("ix_kpi_files_year"), table_name="kpi_files")
    op.drop_index(op.f("ix_kpi_files_organization_id"), table_name="kpi_files")
    op.drop_index(op.f("ix_kpi_files_kpi_id"), table_name="kpi_files")
    op.drop_table("kpi_files")
