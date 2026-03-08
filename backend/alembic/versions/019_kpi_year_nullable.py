"""Make KPI.year nullable – KPI is not tied to a year; data (entries) are scoped by year and time dimension.

Revision ID: 019_kpi_year_nullable
Revises: 018_remove_report_template_year
Create Date: 2026-03-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "019_kpi_year_nullable"
down_revision: Union[str, None] = "018_remove_report_template_year"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "kpis",
        "year",
        existing_type=sa.Integer(),
        nullable=True,
    )


def downgrade() -> None:
    # Backfill NULL years with current year so we can set NOT NULL
    op.execute("UPDATE kpis SET year = EXTRACT(YEAR FROM CURRENT_DATE)::integer WHERE year IS NULL")
    op.alter_column(
        "kpis",
        "year",
        existing_type=sa.Integer(),
        nullable=False,
    )
