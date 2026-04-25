"""Add composite index for multi-line cell lookup.

NOTE: This repo's `alembic_version.version_num` column is VARCHAR(32), so revision ids
must be <= 32 chars.

Revision ID: 036_mline_idx
Revises: 035_kpi_fv_entry_field
Create Date: 2026-04-25
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "036_mline_idx"
down_revision = "035_kpi_fv_entry_field"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Speeds up joins like: kpi_multi_line_cells ON row_id = ? AND sub_field_id = ?
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kpi_multi_line_cells_row_id_sub_field_id "
        "ON kpi_multi_line_cells (row_id, sub_field_id)"
    )
    # Also common for the aggregate path: rows filtered by (entry_id, field_id)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kpi_multi_line_rows_entry_id_field_id "
        "ON kpi_multi_line_rows (entry_id, field_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_kpi_multi_line_rows_entry_id_field_id")
    op.execute("DROP INDEX IF EXISTS ix_kpi_multi_line_cells_row_id_sub_field_id")

