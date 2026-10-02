"""Add cell_type column to kpi_multi_line_cells table.

Revision ID: 053_add_cell_type_to_kpi_multi_line_cells
Revises: 052_add_default_dashboard_id
Create Date: 2026-09-29 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "053_cell_type"
down_revision = "052_add_default_dashboard_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if inspector.has_table("kpi_multi_line_cells"):
        cols = [c["name"] for c in inspector.get_columns("kpi_multi_line_cells")]
        if "cell_type" not in cols:
            op.add_column(
                "kpi_multi_line_cells",
                sa.Column("cell_type", sa.String(32), nullable=True),
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if inspector.has_table("kpi_multi_line_cells"):
        cols = [c["name"] for c in inspector.get_columns("kpi_multi_line_cells")]
        if "cell_type" in cols:
            op.drop_column("kpi_multi_line_cells", "cell_type")
