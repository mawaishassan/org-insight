"""add_report_header_id_to_custom_reports

Revision ID: 3699f6cf7cb1
Revises: 784c7f696be7
Create Date: 2026-08-18 20:20:09.758515

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3699f6cf7cb1'
down_revision: Union[str, None] = '784c7f696be7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('custom_reports', sa.Column('report_header_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_custom_reports_report_header_id'), 'custom_reports', ['report_header_id'], unique=False)
    op.create_foreign_key('fk_custom_reports_report_header_id_custom_report_headers', 'custom_reports', 'custom_report_headers', ['report_header_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_custom_reports_report_header_id_custom_report_headers', 'custom_reports', type_='foreignkey')
    op.drop_index(op.f('ix_custom_reports_report_header_id'), table_name='custom_reports')
    op.drop_column('custom_reports', 'report_header_id')
