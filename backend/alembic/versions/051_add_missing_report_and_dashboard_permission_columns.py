"""Add missing report and dashboard access permission columns.

Revision ID: 051_add_missing_permissions_cols
Revises: 050_user_activities_and_sessions
Create Date: 2026-09-20 19:05:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "051_add_missing_permissions_cols"
down_revision = "050_user_activities_and_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # 1. report_access_permissions
    if inspector.has_table("report_access_permissions"):
        rap_cols = [c["name"] for c in inspector.get_columns("report_access_permissions")]

        if "can_use_unique_value" not in rap_cols:
            op.add_column(
                "report_access_permissions",
                sa.Column("can_use_unique_value", sa.Boolean(), server_default="false", nullable=False),
            )

        if "filter_kpi_id" not in rap_cols:
            op.add_column(
                "report_access_permissions",
                sa.Column("filter_kpi_id", sa.Integer(), sa.ForeignKey("kpis.id", ondelete="CASCADE"), nullable=True),
            )
            op.create_index(
                "ix_report_access_permissions_filter_kpi_id",
                "report_access_permissions",
                ["filter_kpi_id"],
                unique=False,
            )

        if "filter_mli_id" not in rap_cols:
            op.add_column(
                "report_access_permissions",
                sa.Column("filter_mli_id", sa.Integer(), sa.ForeignKey("kpi_fields.id", ondelete="CASCADE"), nullable=True),
            )
            op.create_index(
                "ix_report_access_permissions_filter_mli_id",
                "report_access_permissions",
                ["filter_mli_id"],
                unique=False,
            )

        if "filter_sub_field_key" not in rap_cols:
            op.add_column(
                "report_access_permissions",
                sa.Column("filter_sub_field_key", sa.String(length=100), nullable=True),
            )

        if "filter_column_configs" not in rap_cols:
            op.add_column(
                "report_access_permissions",
                sa.Column("filter_column_configs", sa.JSON(), nullable=True),
            )

        if "filter_operator" not in rap_cols:
            op.add_column(
                "report_access_permissions",
                sa.Column("filter_operator", sa.String(length=50), server_default="=", nullable=False),
            )

    # 2. dashboard_access_permissions
    if inspector.has_table("dashboard_access_permissions"):
        dap_cols = [c["name"] for c in inspector.get_columns("dashboard_access_permissions")]

        if "can_download_widget_pdf" not in dap_cols:
            op.add_column(
                "dashboard_access_permissions",
                sa.Column("can_download_widget_pdf", sa.Boolean(), server_default="true", nullable=False),
            )

        if "can_view_drilldown" not in dap_cols:
            op.add_column(
                "dashboard_access_permissions",
                sa.Column("can_view_drilldown", sa.Boolean(), server_default="true", nullable=False),
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if inspector.has_table("dashboard_access_permissions"):
        dap_cols = [c["name"] for c in inspector.get_columns("dashboard_access_permissions")]
        if "can_view_drilldown" in dap_cols:
            op.drop_column("dashboard_access_permissions", "can_view_drilldown")
        if "can_download_widget_pdf" in dap_cols:
            op.drop_column("dashboard_access_permissions", "can_download_widget_pdf")

    if inspector.has_table("report_access_permissions"):
        rap_cols = [c["name"] for c in inspector.get_columns("report_access_permissions")]
        if "filter_operator" in rap_cols:
            op.drop_column("report_access_permissions", "filter_operator")
        if "filter_column_configs" in rap_cols:
            op.drop_column("report_access_permissions", "filter_column_configs")
        if "filter_sub_field_key" in rap_cols:
            op.drop_column("report_access_permissions", "filter_sub_field_key")
        if "filter_mli_id" in rap_cols:
            op.drop_index("ix_report_access_permissions_filter_mli_id", table_name="report_access_permissions")
            op.drop_column("report_access_permissions", "filter_mli_id")
        if "filter_kpi_id" in rap_cols:
            op.drop_index("ix_report_access_permissions_filter_kpi_id", table_name="report_access_permissions")
            op.drop_column("report_access_permissions", "filter_kpi_id")
        if "can_use_unique_value" in rap_cols:
            op.drop_column("report_access_permissions", "can_use_unique_value")
