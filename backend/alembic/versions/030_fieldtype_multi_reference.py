"""Add multi_reference value to fieldtype enum.

Revision ID: 030_fieldtype_multi_ref
Revises: 029_fieldtype_attachment
"""

from typing import Sequence, Union

from alembic import op


revision: str = "030_fieldtype_multi_ref"
down_revision: Union[str, None] = "029_fieldtype_attachment"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    try:
        op.execute("ALTER TYPE fieldtype ADD VALUE 'multi_reference'")
    except Exception:
        pass


def downgrade() -> None:
    pass
