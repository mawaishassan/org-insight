"""Add default_dashboard_id column to users table.

Revision ID: 052_add_default_dashboard_id
Revises: 051_add_missing_permissions_cols
Create Date: 2026-09-22 12:05:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "052_add_default_dashboard_id"
down_revision = "051_add_missing_permissions_cols"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if inspector.has_table("users"):
        cols = [c["name"] for c in inspector.get_columns("users")]
        if "default_dashboard_id" not in cols:
            op.add_column(
                "users",
                sa.Column(
                    "default_dashboard_id",
                    sa.Integer(),
                    sa.ForeignKey("dashboards.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )
            op.create_index("ix_users_default_dashboard_id", "users", ["default_dashboard_id"])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if inspector.has_table("users"):
        cols = [c["name"] for c in inspector.get_columns("users")]
        if "default_dashboard_id" in cols:
            op.drop_index("ix_users_default_dashboard_id", table_name="users")
            op.drop_column("users", "default_dashboard_id")
