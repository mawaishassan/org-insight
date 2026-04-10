"""Add dashboards and dashboard access permissions.

Revision ID: 031_dashboards
Revises: 030_fieldtype_multi_ref
Create Date: 2026-04-07
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "031_dashboards"
down_revision: Union[str, None] = "030_fieldtype_multi_ref"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table("dashboards") and insp.has_table("dashboard_access_permissions"):
        # Already applied (e.g. partial run or DB aligned by hand); mark revision without failing.
        return

    # Do not use index=True on Columns here — explicit op.create_index below would duplicate
    # the auto-generated index name (e.g. ix_dashboards_organization_id) and fail on PostgreSQL.
    op.create_table(
        "dashboards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("layout", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_dashboards_id", "dashboards", ["id"])
    op.create_index("ix_dashboards_organization_id", "dashboards", ["organization_id"])

    op.create_table(
        "dashboard_access_permissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "dashboard_id",
            sa.Integer(),
            sa.ForeignKey("dashboards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("can_view", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("can_edit", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("dashboard_id", "user_id", name="uq_dashboard_user"),
    )
    op.create_index(
        "ix_dashboard_access_permissions_id", "dashboard_access_permissions", ["id"]
    )
    op.create_index(
        "ix_dashboard_access_permissions_dashboard_id",
        "dashboard_access_permissions",
        ["dashboard_id"],
    )
    op.create_index(
        "ix_dashboard_access_permissions_user_id",
        "dashboard_access_permissions",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_dashboard_access_permissions_user_id", table_name="dashboard_access_permissions")
    op.drop_index("ix_dashboard_access_permissions_dashboard_id", table_name="dashboard_access_permissions")
    op.drop_index("ix_dashboard_access_permissions_id", table_name="dashboard_access_permissions")
    op.drop_table("dashboard_access_permissions")
    op.drop_index("ix_dashboards_organization_id", table_name="dashboards")
    op.drop_index("ix_dashboards_id", table_name="dashboards")
    op.drop_table("dashboards")

