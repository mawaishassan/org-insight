"""Organization and KPI time dimension; KPI entry period_key for multiple entries per year.

Revision ID: 016_time_dimension
Revises: 015_report_body_blocks
Create Date: 2025-03-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "016_time_dimension"
down_revision: Union[str, None] = "015_report_body_blocks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("time_dimension", sa.String(32), nullable=False, server_default="yearly"),
    )
    op.add_column(
        "kpis",
        sa.Column("time_dimension", sa.String(32), nullable=True),
    )
    op.add_column(
        "kpi_entries",
        sa.Column("period_key", sa.String(8), nullable=False, server_default=""),
    )
    op.create_index(op.f("ix_kpi_entries_period_key"), "kpi_entries", ["period_key"], unique=False)
    op.drop_constraint("uq_kpi_entry_org_kpi_year", "kpi_entries", type_="unique")
    op.create_unique_constraint(
        "uq_kpi_entry_org_kpi_year_period",
        "kpi_entries",
        ["organization_id", "kpi_id", "year", "period_key"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_kpi_entry_org_kpi_year_period", "kpi_entries", type_="unique")
    op.create_unique_constraint(
        "uq_kpi_entry_org_kpi_year",
        "kpi_entries",
        ["organization_id", "kpi_id", "year"],
    )
    op.drop_index(op.f("ix_kpi_entries_period_key"), table_name="kpi_entries")
    op.drop_column("kpi_entries", "period_key")
    op.drop_column("kpis", "time_dimension")
    op.drop_column("organizations", "time_dimension")
