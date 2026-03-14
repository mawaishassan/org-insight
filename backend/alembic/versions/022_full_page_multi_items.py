"""Add full_page_multi_items flag to KPI fields.

Revision ID: 022_full_page_multi_items
Revises: 021_carry_forward
Create Date: 2026-03-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "022_full_page_multi_items"
down_revision: Union[str, None] = "021_carry_forward"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "kpi_fields",
        sa.Column("full_page_multi_items", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("kpi_fields", "full_page_multi_items")

