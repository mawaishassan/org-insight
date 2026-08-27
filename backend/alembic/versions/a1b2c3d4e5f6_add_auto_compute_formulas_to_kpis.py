"""Add auto_compute_formulas to kpis

Revision ID: a1b2c3d4e5f6
Revises: 4598fdc00579
Create Date: 2026-08-27

"""
from typing import Union
import sqlalchemy as sa
from alembic import op

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '4598fdc00579'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'kpis',
        sa.Column(
            'auto_compute_formulas',
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column('kpis', 'auto_compute_formulas')
