"""Merge heads 045_force_pwd_reset and a2b3c4d5e6f7_dashboard_perf_indexes.

Revision ID: 046_merge_045_and_a2b3c4d5e6f7
Revises: 045_force_pwd_reset, a2b3c4d5e6f7
Create Date: 2026-09-05

"""

from typing import Sequence, Union

revision: str = "046_merge_045_and_a2b3c4d5e6f7"
down_revision: Union[str, Sequence[str], None] = ("045_force_pwd_reset", "a2b3c4d5e6f7")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
