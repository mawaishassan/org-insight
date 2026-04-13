"""Add mixed_list value to fieldtype enum.

Revision ID: 032_fieldtype_mixed_list
Revises: 031_dashboards
"""

from typing import Sequence, Union

from alembic import op


revision: str = "032_fieldtype_mixed_list"
down_revision: Union[str, None] = "031_dashboards"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    try:
        op.execute("ALTER TYPE fieldtype ADD VALUE 'mixed_list'")
    except Exception:
        pass


def downgrade() -> None:
    pass

