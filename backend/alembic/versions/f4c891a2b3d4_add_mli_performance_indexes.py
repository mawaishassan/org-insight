"""add mli performance indexes

Revision ID: f4c891a2b3d4
Revises: e3b9a7810f2c, 7a89b01c2d3e
Create Date: 2026-09-03 08:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'f4c891a2b3d4'
down_revision = ('e3b9a7810f2c', '7a89b01c2d3e')
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE INDEX IF NOT EXISTS ix_mli_rows_entry_field ON kpi_multi_line_rows (entry_id, field_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_mli_cells_sub_field_val_date ON kpi_multi_line_cells (sub_field_id, value_date);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_mli_cells_sub_field_val_text_short ON kpi_multi_line_cells (sub_field_id, value_text) WHERE length(value_text) <= 255;")
    op.execute("CREATE INDEX IF NOT EXISTS ix_mli_cells_row_sub_field_val_text ON kpi_multi_line_cells (row_id, sub_field_id, value_text) WHERE length(value_text) <= 255;")

def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_mli_rows_entry_field;")
    op.execute("DROP INDEX IF EXISTS ix_mli_cells_sub_field_val_date;")
    op.execute("DROP INDEX IF EXISTS ix_mli_cells_sub_field_val_text_short;")
    op.execute("DROP INDEX IF EXISTS ix_mli_cells_row_sub_field_val_text;")
