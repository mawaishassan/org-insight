"""Add denormalized search_text for multi-line rows.

Revision ID: 038_mline_row_search
Revises: 037_mline_trgm
Create Date: 2026-05-09
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "038_mline_row_search"
down_revision = "037_mline_trgm"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Add column
    op.execute("ALTER TABLE kpi_multi_line_rows ADD COLUMN IF NOT EXISTS search_text TEXT")

    # 2) Backfill from existing cells (best-effort, can be slow once)
    op.execute(
        """
        UPDATE kpi_multi_line_rows r
        SET search_text = src.t
        FROM (
          SELECT
            c.row_id,
            lower(
              string_agg(
                coalesce(
                  c.value_text,
                  c.value_json::text,
                  c.value_number::text,
                  c.value_boolean::text,
                  c.value_date::text,
                  ''
                ),
                ' '
              )
            ) AS t
          FROM kpi_multi_line_cells c
          GROUP BY c.row_id
        ) AS src
        WHERE src.row_id = r.id
        """
    )

    # 3) Index for fast ILIKE/LIKE %term% on rows
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kpi_mline_rows_search_text_trgm "
        "ON kpi_multi_line_rows USING gin (lower(coalesce(search_text, '')) gin_trgm_ops)"
    )

    # 4) Trigger to keep search_text in sync when cells change
    op.execute(
        """
        CREATE OR REPLACE FUNCTION trg_kpi_mline_refresh_search_text() RETURNS trigger AS $$
        DECLARE
          rid integer;
        BEGIN
          rid := COALESCE(NEW.row_id, OLD.row_id);
          UPDATE kpi_multi_line_rows r
          SET search_text = (
            SELECT lower(
              string_agg(
                coalesce(
                  c.value_text,
                  c.value_json::text,
                  c.value_number::text,
                  c.value_boolean::text,
                  c.value_date::text,
                  ''
                ),
                ' '
              )
            )
            FROM kpi_multi_line_cells c
            WHERE c.row_id = rid
          ),
          updated_at = now()
          WHERE r.id = rid;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS tr_kpi_mline_cells_refresh_search_text ON kpi_multi_line_cells")
    op.execute(
        """
        CREATE TRIGGER tr_kpi_mline_cells_refresh_search_text
        AFTER INSERT OR UPDATE OR DELETE ON kpi_multi_line_cells
        FOR EACH ROW EXECUTE FUNCTION trg_kpi_mline_refresh_search_text();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS tr_kpi_mline_cells_refresh_search_text ON kpi_multi_line_cells")
    op.execute("DROP FUNCTION IF EXISTS trg_kpi_mline_refresh_search_text")
    op.execute("DROP INDEX IF EXISTS ix_kpi_mline_rows_search_text_trgm")
    op.execute("ALTER TABLE kpi_multi_line_rows DROP COLUMN IF EXISTS search_text")

