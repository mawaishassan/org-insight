"""add_date_based_data_fetching

Revision ID: b0de70a3b6a4
Revises: 043_odoo_endpoints
Create Date: 2026-08-16 17:00:39.329669

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b0de70a3b6a4'
down_revision: Union[str, None] = '043_odoo_endpoints'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Upgrade organizations table
    op.add_column("organizations", sa.Column("custom_period_name", sa.String(255), nullable=True))
    op.add_column("organizations", sa.Column("custom_period_start_month", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("organizations", sa.Column("custom_period_start_day", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("organizations", sa.Column("custom_period_duration_months", sa.Integer(), nullable=False, server_default="12"))
    op.add_column("organizations", sa.Column("custom_period_display_format", sa.String(32), nullable=False, server_default="YYYY"))
    op.add_column("organizations", sa.Column("custom_period_prefix", sa.String(32), nullable=False, server_default=""))
    op.add_column("organizations", sa.Column("custom_period_suffix", sa.String(32), nullable=False, server_default=""))

    # Upgrade dashboards table
    op.add_column("dashboards", sa.Column("fetch_data_with_date", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("dashboards", sa.Column("date_fetching_config", sa.JSON(), nullable=True))

    # Upgrade report_templates table
    op.add_column("report_templates", sa.Column("fetch_data_with_date", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("report_templates", sa.Column("date_fetching_config", sa.JSON(), nullable=True))

    # Upgrade custom_reports table
    op.add_column("custom_reports", sa.Column("fetch_data_with_date", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("custom_reports", sa.Column("date_fetching_config", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("custom_reports", "date_fetching_config")
    op.drop_column("custom_reports", "fetch_data_with_date")

    op.drop_column("report_templates", "date_fetching_config")
    op.drop_column("report_templates", "fetch_data_with_date")

    op.drop_column("dashboards", "date_fetching_config")
    op.drop_column("dashboards", "fetch_data_with_date")

    op.drop_column("organizations", "custom_period_suffix")
    op.drop_column("organizations", "custom_period_prefix")
    op.drop_column("organizations", "custom_period_display_format")
    op.drop_column("organizations", "custom_period_duration_months")
    op.drop_column("organizations", "custom_period_start_day")
    op.drop_column("organizations", "custom_period_start_month")
    op.drop_column("organizations", "custom_period_name")

