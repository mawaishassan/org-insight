"""Add attachment value to fieldtype enum.

Revision ID: 029_fieldtype_attachment
Revises: 028_ext_auth_cfg_db
Create Date: 2026-03-15
"""

from typing import Sequence, Union

from alembic import op


revision: str = "029_fieldtype_attachment"
down_revision: Union[str, None] = "028_ext_auth_cfg_db"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL enum used by kpi_fields.field_type and kpi_field_sub_fields.field_type.
    # Keep idempotent behavior for environments where value may already exist.
    try:
        op.execute("ALTER TYPE fieldtype ADD VALUE 'attachment'")
    except Exception:
        pass


def downgrade() -> None:
    # PostgreSQL does not support removing enum values safely in-place.
    pass

