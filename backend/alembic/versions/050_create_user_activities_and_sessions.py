"""Create user_activities and user_sessions tables and user login tracking columns.

Revision ID: 050_user_activities_and_sessions
Revises: 049_custom_report_access_mode
Create Date: 2026-09-19 18:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "050_user_activities_and_sessions"
down_revision = "049_custom_report_access_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add login tracking columns to users
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    user_cols = [c["name"] for c in inspector.get_columns("users")]

    if "last_login_at" not in user_cols:
        op.add_column("users", sa.Column("last_login_at", sa.DateTime(), nullable=True))
        op.create_index("ix_users_last_login_at", "users", ["last_login_at"])

    if "last_activity_at" not in user_cols:
        op.add_column("users", sa.Column("last_activity_at", sa.DateTime(), nullable=True))
        op.create_index("ix_users_last_activity_at", "users", ["last_activity_at"])

    if "login_count" not in user_cols:
        op.add_column("users", sa.Column("login_count", sa.Integer(), server_default="0", nullable=False))

    # 2. Create user_sessions table
    tables = inspector.get_table_names()
    if "user_sessions" not in tables:
        op.create_table(
            "user_sessions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("session_id", sa.String(length=128), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("ip_address", sa.String(length=45), nullable=True),
            sa.Column("user_agent", sa.String(length=512), nullable=True),
            sa.Column("login_time", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("last_activity_time", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("logout_time", sa.DateTime(), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="ACTIVE"),
        )
        op.create_index("ix_user_sessions_session_id", "user_sessions", ["session_id"], unique=True)
        op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
        op.create_index("ix_user_sessions_organization_id", "user_sessions", ["organization_id"])
        op.create_index("ix_user_sessions_login_time", "user_sessions", ["login_time"])
        op.create_index("ix_user_sessions_last_activity_time", "user_sessions", ["last_activity_time"])
        op.create_index("ix_user_sessions_status", "user_sessions", ["status"])
        op.create_index("ix_user_sessions_org_user", "user_sessions", ["organization_id", "user_id"])
        op.create_index("ix_user_sessions_org_login", "user_sessions", ["organization_id", "login_time"])

    # 3. Create user_activities table
    if "user_activities" not in tables:
        op.create_table(
            "user_activities",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("session_id", sa.String(length=128), nullable=True),
            sa.Column("unique_user_key", sa.String(length=100), nullable=True),
            sa.Column("user_name", sa.String(length=255), nullable=True),
            sa.Column("user_email", sa.String(length=255), nullable=True),
            sa.Column("department", sa.String(length=255), nullable=True),
            sa.Column("faculty", sa.String(length=255), nullable=True),
            sa.Column("campus", sa.String(length=255), nullable=True),
            sa.Column("module", sa.String(length=50), nullable=False),
            sa.Column("resource_type", sa.String(length=50), nullable=False),
            sa.Column("resource_id", sa.String(length=100), nullable=True),
            sa.Column("resource_name", sa.String(length=255), nullable=True),
            sa.Column("action_type", sa.String(length=60), nullable=False),
            sa.Column("action_details", sa.Text(), nullable=True),
            sa.Column("reporting_period", sa.String(length=100), nullable=True),
            sa.Column("kpi_id", sa.Integer(), nullable=True),
            sa.Column("dashboard_id", sa.Integer(), nullable=True),
            sa.Column("widget_id", sa.String(length=100), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="SUCCESS"),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("records_affected", sa.Integer(), nullable=True),
            sa.Column("ip_address", sa.String(length=45), nullable=True),
            sa.Column("user_agent", sa.String(length=512), nullable=True),
            sa.Column("meta_data", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_user_activities_organization_id", "user_activities", ["organization_id"])
        op.create_index("ix_user_activities_user_id", "user_activities", ["user_id"])
        op.create_index("ix_user_activities_session_id", "user_activities", ["session_id"])
        op.create_index("ix_user_activities_unique_user_key", "user_activities", ["unique_user_key"])
        op.create_index("ix_user_activities_module", "user_activities", ["module"])
        op.create_index("ix_user_activities_resource_type", "user_activities", ["resource_type"])
        op.create_index("ix_user_activities_resource_id", "user_activities", ["resource_id"])
        op.create_index("ix_user_activities_action_type", "user_activities", ["action_type"])
        op.create_index("ix_user_activities_kpi_id", "user_activities", ["kpi_id"])
        op.create_index("ix_user_activities_dashboard_id", "user_activities", ["dashboard_id"])
        op.create_index("ix_user_activities_created_at", "user_activities", ["created_at"])

        # Composite high-performance indexes
        op.create_index("ix_user_activities_org_created", "user_activities", ["organization_id", "created_at"])
        op.create_index("ix_user_activities_org_user", "user_activities", ["organization_id", "user_id", "created_at"])
        op.create_index("ix_user_activities_org_module", "user_activities", ["organization_id", "module", "created_at"])
        op.create_index("ix_user_activities_org_action", "user_activities", ["organization_id", "action_type", "created_at"])
        op.create_index("ix_user_activities_org_res", "user_activities", ["organization_id", "resource_type", "resource_id"])


def downgrade() -> None:
    op.drop_table("user_activities")
    op.drop_table("user_sessions")
    op.drop_index("ix_users_last_login_at", table_name="users")
    op.drop_index("ix_users_last_activity_at", table_name="users")
    op.drop_column("users", "login_count")
    op.drop_column("users", "last_activity_at")
    op.drop_column("users", "last_login_at")
