"""add_report_name_and_branding_options_to_custom_reports

Revision ID: fe54f95fbab5
Revises: 3699f6cf7cb1
Create Date: 2026-08-18 20:26:23.970997

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fe54f95fbab5'
down_revision: Union[str, None] = '3699f6cf7cb1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('custom_reports', sa.Column('show_report_name', sa.Boolean(), nullable=False, server_default='true'))
    op.add_column('custom_reports', sa.Column('branding_title', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('custom_reports', 'branding_title')
    op.drop_column('custom_reports', 'show_report_name')
