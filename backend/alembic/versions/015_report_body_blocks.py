"""Add body_blocks JSON column for visual report builder.

Revision ID: 015_report_body_blocks
Revises: 014_kpi_files
Create Date: 2025-02-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "015_report_body_blocks"
down_revision: Union[str, None] = "014_kpi_files"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "report_templates",
        sa.Column("body_blocks", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("report_templates", "body_blocks")
