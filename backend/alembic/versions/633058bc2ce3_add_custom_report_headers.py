"""add_custom_report_headers

Revision ID: 633058bc2ce3
Revises: 308191b9a4d6
Create Date: 2026-08-18 11:16:23.210498

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '633058bc2ce3'
down_revision: Union[str, None] = '308191b9a4d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create custom_report_headers table
    op.create_table(
        'custom_report_headers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('logo_path', sa.String(length=1024), nullable=False),
        sa.Column('main_heading', sa.String(length=512), nullable=False),
        sa.Column('sub_heading', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_custom_report_headers_id'), 'custom_report_headers', ['id'], unique=False)
    op.create_index(op.f('ix_custom_report_headers_organization_id'), 'custom_report_headers', ['organization_id'], unique=False)

    # Add report_header_id column to kpis table
    op.add_column('kpis', sa.Column('report_header_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_kpis_report_header_id'), 'kpis', ['report_header_id'], unique=False)
    op.create_foreign_key('fk_kpis_report_header_id_custom_report_headers', 'kpis', 'custom_report_headers', ['report_header_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    # Drop foreign key and column from kpis table
    op.drop_constraint('fk_kpis_report_header_id_custom_report_headers', 'kpis', type_='foreignkey')
    op.drop_index(op.f('ix_kpis_report_header_id'), table_name='kpis')
    op.drop_column('kpis', 'report_header_id')

    # Drop custom_report_headers table
    op.drop_index(op.f('ix_custom_report_headers_organization_id'), table_name='custom_report_headers')
    op.drop_index(op.f('ix_custom_report_headers_id'), table_name='custom_report_headers')
    op.drop_table('custom_report_headers')
