"""Add carry_forward_data (non-cyclic) to KPIs and KPI fields.

Revision ID: 021_carry_forward
Revises: 020_reference
Create Date: 2026-03-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "021_carry_forward"
down_revision: Union[str, None] = "020_reference"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "kpis",
        sa.Column("carry_forward_data", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column(
        "kpi_fields",
        sa.Column("carry_forward_data", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("kpi_fields", "carry_forward_data")
    op.drop_column("kpis", "carry_forward_data")
