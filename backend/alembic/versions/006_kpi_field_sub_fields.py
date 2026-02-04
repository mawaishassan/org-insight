"""Add kpi_field_sub_fields for structured multi_line_items.

Revision ID: 006_sub_fields
Revises: 005_card_display
Create Date: 2025-02-04

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "006_sub_fields"
down_revision: Union[str, None] = "005_card_display"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create table without field_type first to avoid SQLAlchemy trying to create the enum type.
    # The "fieldtype" enum already exists from 001_initial_schema.
    op.create_table(
        "kpi_field_sub_fields",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("field_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("is_required", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("sort_order", sa.Integer(), nullable=True, server_default="0"),
        sa.ForeignKeyConstraint(["field_id"], ["kpi_fields.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Add column using existing PostgreSQL enum type (no CREATE TYPE).
    op.execute("ALTER TABLE kpi_field_sub_fields ADD COLUMN field_type fieldtype NOT NULL DEFAULT 'single_line_text'")
    op.execute("ALTER TABLE kpi_field_sub_fields ALTER COLUMN field_type DROP DEFAULT")
    op.create_index("ix_kpi_field_sub_fields_field_id", "kpi_field_sub_fields", ["field_id"], unique=False)
    op.create_index("ix_kpi_field_sub_fields_key", "kpi_field_sub_fields", ["key"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_kpi_field_sub_fields_key", table_name="kpi_field_sub_fields")
    op.drop_index("ix_kpi_field_sub_fields_field_id", table_name="kpi_field_sub_fields")
    op.drop_table("kpi_field_sub_fields")
