"""add_sub_heading_styling_to_custom_report_headers

Revision ID: 784c7f696be7
Revises: 2d305c065ee2
Create Date: 2026-08-18 14:24:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '784c7f696be7'
down_revision: Union[str, None] = '2d305c065ee2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('custom_report_headers',
        sa.Column('sub_font_family', sa.String(length=50), nullable=True, server_default='Helvetica'))
    op.add_column('custom_report_headers',
        sa.Column('sub_font_size', sa.Integer(), nullable=True, server_default='11'))
    op.add_column('custom_report_headers',
        sa.Column('sub_text_color', sa.String(length=10), nullable=True, server_default='#4b5563'))
    op.add_column('custom_report_headers',
        sa.Column('sub_text_align', sa.String(length=20), nullable=True, server_default='center'))


def downgrade() -> None:
    op.drop_column('custom_report_headers', 'sub_text_align')
    op.drop_column('custom_report_headers', 'sub_text_color')
    op.drop_column('custom_report_headers', 'sub_font_size')
    op.drop_column('custom_report_headers', 'sub_font_family')
