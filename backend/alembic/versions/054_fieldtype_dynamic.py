"""Add dynamic value to fieldtype enum.

Revision ID: 054_fieldtype_dynamic
Revises: 053_cell_type
"""

from typing import Sequence, Union
from alembic import op


revision: str = "054_fieldtype_dynamic"
down_revision: Union[str, None] = "053_cell_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    try:
        op.execute("ALTER TYPE fieldtype ADD VALUE IF NOT EXISTS 'dynamic'")
    except Exception:
        pass


def downgrade() -> None:
    pass
