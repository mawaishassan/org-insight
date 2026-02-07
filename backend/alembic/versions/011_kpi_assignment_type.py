"""Add assignment_type to kpi_assignments (data_entry | view).

Revision ID: 011_assignment_type
Revises: 010_kpi_entry_mode
Create Date: 2025-02-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "011_assignment_type"
down_revision: Union[str, None] = "010_kpi_entry_mode"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "kpi_assignments",
        sa.Column("assignment_type", sa.String(20), nullable=False, server_default="data_entry"),
    )


def downgrade() -> None:
    op.drop_column("kpi_assignments", "assignment_type")
