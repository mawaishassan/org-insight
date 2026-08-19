"""add_text_align_to_custom_report_headers

Revision ID: 2d305c065ee2
Revises: 9d1a613743af
Create Date: 2026-08-18 14:08:30.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2d305c065ee2'
down_revision: Union[str, None] = '9d1a613743af'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('custom_report_headers',
        sa.Column('text_align', sa.String(length=20), nullable=True, server_default='center'))


def downgrade() -> None:
    op.drop_column('custom_report_headers', 'text_align')
