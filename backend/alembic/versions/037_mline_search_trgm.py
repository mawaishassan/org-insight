"""Speed up multi-line free-text search with pg_trgm.

Revision ID: 037_mline_trgm
Revises: 036_mline_idx
Create Date: 2026-05-09
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "037_mline_trgm"
down_revision = "036_mline_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Needed for gin_trgm_ops indexes.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # NOTE: Postgres requires index expressions to use IMMUTABLE functions only.
    # Casting date/number/boolean to text is not IMMUTABLE, so we index the columns
    # that are naturally textual (value_text + value_json::text).
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kpi_mline_cells_value_text_trgm "
        "ON kpi_multi_line_cells USING gin (lower(coalesce(value_text, '')) gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kpi_mline_cells_value_json_trgm "
        "ON kpi_multi_line_cells USING gin (lower(coalesce(value_json::text, '')) gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_kpi_mline_cells_value_json_trgm")
    op.execute("DROP INDEX IF EXISTS ix_kpi_mline_cells_value_text_trgm")
    # Keep extension (safe / shared); don't drop pg_trgm automatically.

