"""Merge heads 019_report_template_mode and 033_multi_line_items_relational_storage.

Revision ID: 034_merge_heads_019_and_033
Revises: 019_report_template_mode, 033_ml_items_rel_storage
Create Date: 2026-04-23

"""

from typing import Sequence, Union

revision: str = "034_merge_heads_019_and_033"
down_revision: Union[str, Sequence[str], None] = ("019_report_template_mode", "033_ml_items_rel_storage")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

