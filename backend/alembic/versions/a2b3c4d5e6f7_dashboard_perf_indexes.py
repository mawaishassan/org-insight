"""add dashboard performance indexes for multi-user load

Revision ID: a2b3c4d5e6f7
Revises: f4c891a2b3d4
Create Date: 2026-09-04 22:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'a2b3c4d5e6f7'
down_revision = 'f4c891a2b3d4'
branch_labels = None
depends_on = None


def upgrade():
    # Fast user permission lookup — used on every batch call for non-admin users
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_dashboard_access_perm_user_dashboard "
        "ON dashboard_access_permissions (user_id, dashboard_id);"
    )
    # Fast entry lookup by kpi+year+period — core of every widget data call
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kpi_entry_kpi_year_period_draft "
        "ON kpi_entries (kpi_id, year, period_key) "
        "WHERE is_draft = false;"
    )
    # Fast KPI org membership check — used in auth guard
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kpi_org_id_id "
        "ON kpis (organization_id, id);"
    )
    # Fast dashboard org lookup (used in can_view_dashboard_for_kpi_chart)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_dashboard_org_id "
        "ON dashboards (organization_id, id);"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_dashboard_access_perm_user_dashboard;")
    op.execute("DROP INDEX IF EXISTS ix_kpi_entry_kpi_year_period_draft;")
    op.execute("DROP INDEX IF EXISTS ix_kpi_org_id_id;")
    op.execute("DROP INDEX IF EXISTS ix_dashboard_org_id;")
