"""add_missing_report_columns

Revision ID: 5dd439de9e68
Revises: fe54f95fbab5
Create Date: 2026-08-19 15:13:42.762076

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5dd439de9e68'
down_revision: Union[str, None] = 'fe54f95fbab5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('custom_reports', sa.Column('scalar_bold', sa.Boolean(), nullable=False, server_default='true'))
    op.add_column('custom_reports', sa.Column('scalar_font_size', sa.Integer(), nullable=False, server_default='11'))
    op.add_column('custom_reports', sa.Column('mli_font_size', sa.Integer(), nullable=False, server_default='10'))
    op.add_column('custom_reports', sa.Column('show_odoo_button', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('custom_reports', sa.Column('odoo_sync_kpi_ids', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('custom_reports', 'odoo_sync_kpi_ids')
    op.drop_column('custom_reports', 'show_odoo_button')
    op.drop_column('custom_reports', 'mli_font_size')
    op.drop_column('custom_reports', 'scalar_font_size')
    op.drop_column('custom_reports', 'scalar_bold')
