"""backfill_header_style_defaults_and_server_defaults

Revision ID: 0a1a2eaf1c1f
Revises: a99c0becd0b7
Create Date: 2026-08-18 12:40:06.892625

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a1a2eaf1c1f'
down_revision: Union[str, None] = 'a99c0becd0b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Backfill existing NULL rows with sensible defaults
    op.execute(
        "UPDATE custom_report_headers SET font_family = 'Helvetica' WHERE font_family IS NULL"
    )
    op.execute(
        "UPDATE custom_report_headers SET font_size = 16 WHERE font_size IS NULL"
    )
    op.execute(
        "UPDATE custom_report_headers SET text_color = '#1e3a8a' WHERE text_color IS NULL"
    )

    # 2. Add server_default so new rows are never NULL even if the application omits the value
    with op.batch_alter_table('custom_report_headers') as batch_op:
        batch_op.alter_column(
            'font_family',
            existing_type=sa.String(length=50),
            server_default='Helvetica',
            existing_nullable=True,
        )
        batch_op.alter_column(
            'font_size',
            existing_type=sa.Integer(),
            server_default='16',
            existing_nullable=True,
        )
        batch_op.alter_column(
            'text_color',
            existing_type=sa.String(length=10),
            server_default='#1e3a8a',
            existing_nullable=True,
        )


def downgrade() -> None:
    # Remove server_default (data backfill is not reversed to avoid data loss)
    with op.batch_alter_table('custom_report_headers') as batch_op:
        batch_op.alter_column(
            'font_family',
            existing_type=sa.String(length=50),
            server_default=None,
            existing_nullable=True,
        )
        batch_op.alter_column(
            'font_size',
            existing_type=sa.Integer(),
            server_default=None,
            existing_nullable=True,
        )
        batch_op.alter_column(
            'text_color',
            existing_type=sa.String(length=10),
            server_default=None,
            existing_nullable=True,
        )
