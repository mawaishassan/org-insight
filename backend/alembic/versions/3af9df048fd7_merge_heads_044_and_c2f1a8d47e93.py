"""merge_heads_044_and_c2f1a8d47e93

Revision ID: 3af9df048fd7
Revises: 044_mli_wrapping, c2f1a8d47e93
Create Date: 2026-08-24 11:26:01.874882

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3af9df048fd7'
down_revision: Union[str, None] = ('044_mli_wrapping', 'c2f1a8d47e93')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
