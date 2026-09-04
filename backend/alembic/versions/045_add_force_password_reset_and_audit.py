"""add force password reset columns and audit table

Revision ID: 045_force_pwd_reset
Revises: f4c891a2b3d4
Create Date: 2026-09-04 18:55:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '045_force_pwd_reset'
down_revision = 'f4c891a2b3d4'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add columns to users table
    op.add_column(
        'users',
        sa.Column('force_password_reset', sa.Boolean(), server_default=sa.text('false'), nullable=False)
    )
    op.add_column(
        'users',
        sa.Column('password_reset_requested_at', sa.DateTime(), nullable=True)
    )
    op.add_column(
        'users',
        sa.Column('password_reset_completed_at', sa.DateTime(), nullable=True)
    )
    op.add_column(
        'users',
        sa.Column('password_reset_requested_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    )

    # 2. Create password_reset_audits table
    op.create_table(
        'password_reset_audits',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('admin_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='PENDING', index=True),
        sa.Column('requested_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_table('password_reset_audits')
    op.drop_column('users', 'password_reset_requested_by_id')
    op.drop_column('users', 'password_reset_completed_at')
    op.drop_column('users', 'password_reset_requested_at')
    op.drop_column('users', 'force_password_reset')
