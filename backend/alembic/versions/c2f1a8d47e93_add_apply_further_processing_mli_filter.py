"""add_apply_further_processing_mli_filter_to_custom_reports

Revision ID: c2f1a8d47e93
Revises: fe54f95fbab5
Create Date: 2026-08-23 17:27:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2f1a8d47e93'
down_revision: Union[str, None] = 'fe54f95fbab5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'custom_reports',
        sa.Column(
            'apply_further_processing_based_on_mli_filter',
            sa.Boolean(),
            nullable=False,
            server_default='false',
        )
    )


def downgrade() -> None:
    op.drop_column('custom_reports', 'apply_further_processing_based_on_mli_filter')
