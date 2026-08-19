"""add_logo2_kpi_name_color_org_branding

Revision ID: 9d1a613743af
Revises: 0a1a2eaf1c1f
Create Date: 2026-08-18 13:01:18.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9d1a613743af'
down_revision: Union[str, None] = '0a1a2eaf1c1f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add logo_path_2 to custom_report_headers
    op.add_column('custom_report_headers',
        sa.Column('logo_path_2', sa.String(length=1024), nullable=True))

    # Add kpi_name_color to custom_report_headers (default blue)
    op.add_column('custom_report_headers',
        sa.Column('kpi_name_color', sa.String(length=10), nullable=True,
                  server_default='#1e3a8a'))

    # Create organization_brandings table
    op.create_table(
        'organization_brandings',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('organization_id', sa.Integer(),
                  sa.ForeignKey('organizations.id', ondelete='CASCADE'),
                  nullable=False, index=True, unique=True),
        sa.Column('footer_label', sa.String(length=512), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('organization_brandings')
    op.drop_column('custom_report_headers', 'kpi_name_color')
    op.drop_column('custom_report_headers', 'logo_path_2')
