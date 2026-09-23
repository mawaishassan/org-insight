"""Add per-user access mode columns to custom_report_assignments.

This migration adds the same access-mode and filter columns that
DashboardAccessPermission and ReportAccessPermission already have,
so custom report access mode is stored per-user (not per-report via
ReportUserFilterConfiguration which incorrectly shared the same
enabled flag across all users of a report).

Revision ID: 049_custom_report_per_user_access_mode
Revises: 048_rights_mgmt
Create Date: 2026-09-15 09:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "049_custom_report_access_mode"
down_revision = "df258311552f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if inspector.has_table("custom_report_assignments"):
        cra_cols = [c["name"] for c in inspector.get_columns("custom_report_assignments")]
        # Add per-user access mode flag
        if "can_use_unique_value" not in cra_cols:
            op.add_column(
                "custom_report_assignments",
                sa.Column(
                    "can_use_unique_value",
                    sa.Boolean(),
                    server_default=sa.text("false"),
                    nullable=False,
                ),
            )
        # Add filter configuration columns (nullable - only populated when can_use_unique_value=true)
        if "filter_kpi_id" not in cra_cols:
            op.add_column(
                "custom_report_assignments",
                sa.Column("filter_kpi_id", sa.Integer(), nullable=True),
            )
        if "filter_mli_id" not in cra_cols:
            op.add_column(
                "custom_report_assignments",
                sa.Column("filter_mli_id", sa.Integer(), nullable=True),
            )
        if "filter_sub_field_key" not in cra_cols:
            op.add_column(
                "custom_report_assignments",
                sa.Column("filter_sub_field_key", sa.String(255), nullable=True),
            )
        if "filter_column_configs" not in cra_cols:
            op.add_column(
                "custom_report_assignments",
                sa.Column("filter_column_configs", sa.JSON(), nullable=True),
            )
        if "filter_operator" not in cra_cols:
            op.add_column(
                "custom_report_assignments",
                sa.Column(
                    "filter_operator",
                    sa.String(50),
                    server_default=sa.text("'='"),
                    nullable=False,
                ),
            )

    # Back-fill: any report that currently has ReportUserFilterConfiguration.enabled=True
    # should set can_use_unique_value=True on all of its assignments, preserving existing
    # key-based access for users already configured via the old global mechanism.
    op.execute(
        sa.text("""
        UPDATE custom_report_assignments
        SET can_use_unique_value = true,
            filter_kpi_id = (
                SELECT kpi_id FROM report_user_filter_configurations
                WHERE report_id = custom_report_assignments.custom_report_id
                  AND enabled = true
                LIMIT 1
            ),
            filter_mli_id = (
                SELECT mli_id FROM report_user_filter_configurations
                WHERE report_id = custom_report_assignments.custom_report_id
                  AND enabled = true
                LIMIT 1
            )
        WHERE custom_report_id IN (
            SELECT report_id FROM report_user_filter_configurations WHERE enabled = true
        )
        """)
    )


def downgrade() -> None:
    op.drop_column("custom_report_assignments", "filter_operator")
    op.drop_column("custom_report_assignments", "filter_column_configs")
    op.drop_column("custom_report_assignments", "filter_sub_field_key")
    op.drop_column("custom_report_assignments", "filter_mli_id")
    op.drop_column("custom_report_assignments", "filter_kpi_id")
    op.drop_column("custom_report_assignments", "can_use_unique_value")
