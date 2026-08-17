"""add_custom_periods_json_to_org

Revision ID: 308191b9a4d6
Revises: b0de70a3b6a4
Create Date: 2026-08-16 19:39:05.058450

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '308191b9a4d6'
down_revision: Union[str, None] = 'b0de70a3b6a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("custom_periods", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "custom_periods")
