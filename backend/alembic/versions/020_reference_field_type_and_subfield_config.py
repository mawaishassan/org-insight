"""Add reference field type and sub_field config for reference/lookup.

Revision ID: 020_reference
Revises: 019_kpi_year_nullable
Create Date: 2026-03-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "020_reference"
down_revision: Union[str, None] = "019_kpi_year_nullable"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new enum value for reference/lookup field type (idempotent in PG 10+ with IF NOT EXISTS; otherwise run once)
    try:
        op.execute("ALTER TYPE fieldtype ADD VALUE 'reference'")
    except Exception:
        pass  # already exists
    op.add_column(
        "kpi_field_sub_fields",
        sa.Column("config", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("kpi_field_sub_fields", "config")
    # PostgreSQL does not support removing an enum value easily; leave 'reference' in fieldtype
    pass
