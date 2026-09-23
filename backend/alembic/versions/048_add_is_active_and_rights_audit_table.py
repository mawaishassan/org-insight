"""Add is_active to rights tables and create access_management_audits table.

Revision ID: 048_add_is_active_and_rights_audit
Revises: 047_drop_uq_org_unique_user_key
Create Date: 2026-09-08 11:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "048_rights_mgmt"
down_revision = "047_drop_uq_org_unique_user_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # 1. Add is_active column with default True to permission tables
    if inspector.has_table("dashboard_access_permissions"):
        dap_cols = [c["name"] for c in inspector.get_columns("dashboard_access_permissions")]
        if "is_active" not in dap_cols:
            op.add_column(
                "dashboard_access_permissions",
                sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )

    if inspector.has_table("custom_report_assignments"):
        cra_cols = [c["name"] for c in inspector.get_columns("custom_report_assignments")]
        if "is_active" not in cra_cols:
            op.add_column(
                "custom_report_assignments",
                sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )

    if inspector.has_table("report_access_permissions"):
        rap_cols = [c["name"] for c in inspector.get_columns("report_access_permissions")]
        if "is_active" not in rap_cols:
            op.add_column(
                "report_access_permissions",
                sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            )

    # 2. Create access_management_audits table
    if not inspector.has_table("access_management_audits"):
        op.create_table(
            "access_management_audits",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("resource_type", sa.String(length=30), nullable=False, index=True),
        sa.Column("resource_id", sa.Integer(), nullable=False, index=True),
        sa.Column("resource_name", sa.String(length=255), nullable=True),
        sa.Column("action", sa.String(length=50), nullable=False, index=True),
        sa.Column("previous_access", sa.JSON(), nullable=True),
        sa.Column("new_access", sa.JSON(), nullable=True),
        sa.Column("previous_config", sa.JSON(), nullable=True),
        sa.Column("new_config", sa.JSON(), nullable=True),
        sa.Column(
            "changed_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    op.drop_table("access_management_audits")
    op.drop_column("report_access_permissions", "is_active")
    op.drop_column("custom_report_assignments", "is_active")
    op.drop_column("dashboard_access_permissions", "is_active")
