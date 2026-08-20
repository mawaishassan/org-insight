"""modify_mline_row_search_text_trigger

Revision ID: 898d8a7a1470
Revises: 5dd439de9e68
Create Date: 2026-08-20 15:27:18.396466

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '898d8a7a1470'
down_revision: Union[str, None] = '5dd439de9e68'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            CREATE OR REPLACE FUNCTION trg_kpi_mline_refresh_search_text() RETURNS trigger AS $$
            DECLARE
              rid integer;
            BEGIN
              -- Safe check for session bypass variable
              IF current_setting('app.disable_search_rebuild', true) = 'on' THEN
                RETURN NULL;
              END IF;
              
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


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
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

