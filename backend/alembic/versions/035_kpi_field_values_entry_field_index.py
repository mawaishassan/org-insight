"""Composite index on kpi_field_values (entry_id, field_id) for widget/chart lookups.

Revision ID: 035_kpi_fv_entry_field
Revises: 034_merge_heads_019_and_033
Create Date: 2026-04-25

"""

from typing import Sequence, Union

from alembic import op


revision: str = "035_kpi_fv_entry_field"
down_revision: Union[str, None] = "034_merge_heads_019_and_033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_kpi_field_values_entry_id_field_id",
        "kpi_field_values",
        ["entry_id", "field_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_kpi_field_values_entry_id_field_id", table_name="kpi_field_values")
